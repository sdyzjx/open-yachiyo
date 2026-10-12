# Android Companion 接口契约（唯一事实来源）

> 类型: plan
> 状态: active
> 负责人: claude-coordinator（修改需经统筹者确认）
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-companion.md

本文件定义各工作流之间的接口。**任何工作流不得单方面修改这里的格式**；需要变更时在自己的施工文档「待统筹决策」里写明，由统筹者更新本文件。

- C1 Device Hub 协议（网关 ↔ 手机 / 桌面）
- C2 Android JS Bridge（原生壳 ↔ WebView 前端）
- C3 插件包格式与插件 SDK
- C4 模型配置 schema v2 与模型目录（Model Catalog）
- C5 Agent 核心（pi）与网关/工具/设备的集成点
- C6 Android 资源目录约定

---

## C1. Device Hub 协议

### C1.1 连接

```
ws://<gateway-host>:<port>/ws/device?token=<pairing_token>
```

- `pairing_token`：网关配置 `~/yachiyo/config/device-hub.yaml` 的 `pairing_token`；首次启动自动生成 24 字节随机 token 并打印到控制台和 `GET /api/device/pairing`（仅 localhost 可访问）。token 不匹配直接 `close(1008)`。
- 所有帧为 UTF-8 JSON 文本帧。
- 心跳：客户端每 `heartbeat_ms`（默认 15000）发 `ping`；服务端 2 个周期未收到则断开。客户端断线后指数退避重连（1s → 30s）。

### C1.2 信封

```json
{ "v": 1, "type": "<type>", "id": "<可选，rpc 关联 id>", "topic": "<可选>", "data": {}, "ts": 1760000000000 }
```

| type | 方向 | 说明 |
|---|---|---|
| `hello` | C→S | 连接后第一帧，见 C1.3 |
| `welcome` | S→C | 握手结果 |
| `ping` / `pong` | 双向 | 心跳 |
| `sub` | C→S | `data.topics: string[]`，支持通配：`avatar.*`、`plugin.x.**`（`*` 单段，`**` 多段），`*` 表示全部可见主题 |
| `unsub` | C→S | 同上 |
| `pub` | C→S | 发布：`topic` + `data`；可选 `data.__target`（device_id）定向投递 |
| `event` | S→C | 投递：`topic` + `data` + `from`（`"runtime"` / `"gateway"` / device_id） |
| `rpc.req` | 双向 | `id` + `data: { method, params, target? }` |
| `rpc.res` | 双向 | `id` + `data: { result }` 或 `data: { error: { code, message, data? } }` |
| `rpc.register` | C→S | 设备/插件注册可被调用的方法，见 C1.6 |
| `rpc.unregister` | C→S | `data.methods: string[]` |
| `error` | S→C | 协议错误 `data: { code, message, ref_id? }` |

错误码沿用 JSON-RPC：`-32600` 非法请求、`-32601` 方法不存在、`-32602` 参数错误、`-32003` 超时、`-32006` 权限拒绝、`-32010` 目标设备离线。

### C1.3 握手

`hello.data`：

```json
{
  "device_id": "android-<uuid>",            // 客户端首次生成并持久化
  "device_type": "android",                  // android | desktop | web
  "name": "MI 6",
  "app_version": "0.1.0",
  "mode": "normal",                          // normal | lockscreen
  "capabilities": ["live2d", "audio.play", "audio.capture", "plugins"],
  "screen": { "w": 1080, "h": 1920, "dpr": 3, "orientation": "portrait" }
}
```

`welcome.data`：

```json
{ "device_id": "...", "server_version": "0.1.1", "heartbeat_ms": 15000,
  "avatar_host": "desktop", "devices": [ { "device_id": "...", "device_type": "...", "name": "...", "mode": "..." } ],
  "session_id": "device-<device_id>" }
```

`mode` 可在连接期间通过 `pub sys.device.mode {mode}` 更新（进入/离开锁屏）。

### C1.4 主题命名空间

| 命名空间 | 生产者 | 说明 |
|---|---|---|
| `ui.live2d.action` | runtime | 与桌面一致，payload 为 `apps/desktop-live2d/shared/live2dActionMessage.js` 规范化消息；**只投递给当前 avatar host** |
| `ui.*` / `client.*` | runtime | 原 `/ws` 转发的事件，原样转发给订阅者 |
| `chat.delta` | gateway | `{ session_id, trace_id, delta }`（映射自 `message.delta`） |
| `chat.final` | gateway | `{ session_id, trace_id, output }`（映射自 `runtime.final`） |
| `chat.input` | device | `{ text, session_id? }` → 网关以设备会话执行 `runtime.run` |
| `task.update` | gateway | 任务画布：`{ task_id, title, status: running\|done\|failed, steps: [{name, status}], updated_at }`，由 tool_call 事件聚合 |
| `avatar.*` | gateway / device | 设备间移交，见 C1.5 |
| `voice.play` | gateway | `{ request_id, url, mime, text, session_id }`：设备拉取 `url`（同网关、带 token）播放 |
| `voice.stream.start/chunk/end/error` | gateway | 实时 TTS：`start {request_id, sample_rate, format:"pcm_s16le"}`，`chunk {request_id, seq, data_b64}`，`end {request_id}` |
| `voice.playback.started/ended` | device | 播放回执 `{ request_id }` |
| `audio.input.start/chunk/end` | device | 麦克风上行，见 C1.7 |
| `audio.input.transcript` | gateway | `{ stream_id, text, final, error? }` |
| `plugin.install` | gateway | `{ plugin_id, version, url, sha256, size }` 推送插件 |
| `plugin.installed` / `plugin.install_failed` | device | 回执 |
| `plugin.<plugin_id>.**` | 插件 | 插件私有命名空间，插件之间、插件与电脑端 agent 之间通信 |
| `sys.device.online` / `sys.device.offline` | gateway | `{ device_id, device_type, name }` |
| `sys.device.mode` | device | `{ mode }` |
| `sys.config.changed` | gateway | 预留 |

**桥接规则**：
- runtime bus → hub：网关订阅 `bus.subscribe('*')`，前缀在 `ui.` `client.` `voice.` `avatar.` `task.` `plugin.` `sys.` 的主题投递给订阅了匹配模式的设备（`ui.live2d.action` 与 `voice.*` 只投递给 avatar host）。
- hub → runtime bus：设备 `pub` 的主题若前缀在 `plugin.` `device.` `avatar.` `audio.` `chat.` `sys.`，网关以同名 topic `bus.publish`，payload 附加 `__from_device`。
- **锁屏模式**（`mode=lockscreen`）设备：拒绝 `plugin.*` 的 pub/sub 与 `plugin.install`，返回 `-32006`。其他功能（avatar、voice、audio.input、chat）正常。

### C1.5 Avatar 移交（桌面 ↔ 手机）

状态由网关持有：`avatar_host ∈ { "desktop", <device_id> }`，持久化到 `~/yachiyo/data/device-hub/state.json`。桌面 Electron 也作为 Device Hub 客户端连接（`device_type=desktop`，`device_id=desktop-<hostname>`）；`avatar_host: "desktop"` 指任意 desktop 类型客户端（单桌面假设）。

触发：任意设备 `rpc.req avatar.transfer {to: "desktop" | device_id}`，或 HTTP `POST /api/device/avatar/transfer`，或 agent 工具 `avatar_transfer`。

时序（`transfer_id` 由网关生成，每步超时 4 s，超时即视为完成继续下一步）：

```mermaid
sequenceDiagram
  participant S as 源设备
  participant G as 网关
  participant T as 目标设备
  G->>T: event avatar.transfer.prepare {transfer_id, from, to}
  T-->>G: pub avatar.transfer.ready {transfer_id}   (模型已预加载、隐藏在屏幕下方)
  G->>S: event avatar.transfer.exit {transfer_id, to}
  S-->>G: pub avatar.transfer.exited {transfer_id}  (从屏幕下方离开)
  G->>G: avatar_host = to; 广播 avatar.host.changed {host, prev, transfer_id}
  G->>T: event avatar.transfer.enter {transfer_id, from}
  T-->>G: pub avatar.transfer.entered {transfer_id}  (从屏幕下方升起)
  G->>G: 广播 avatar.transfer.completed {transfer_id, host}
```

失败（目标离线 / prepare 超时 8 s）→ 广播 `avatar.transfer.failed {transfer_id, reason}`，host 不变，源设备收到 `avatar.transfer.cancel` 恢复显示。

动画规范（两端一致）：离开 = 人物先轻微下蹲（y +2%，120 ms），再沿屏幕下方滑出（y → 屏幕高度 + 模型高度，480 ms，`cubic-bezier(.55,0,.75,.2)`）；进入 = 从下方滑入（520 ms，`cubic-bezier(.2,.8,.2,1.1)` 带轻微回弹）后播放 `greet` 动作。

非 host 设备：不渲染人物（桌面隐藏模型、保留窗口），不播放 TTS，但仍可显示聊天/任务画布与插件。

### C1.6 设备 RPC 方法注册（供 agent 作为工具调用）

`rpc.register.data`：

```json
{ "methods": [
  { "name": "device.vibrate", "description": "让手机振动", "params_schema": { "type": "object", "properties": { "ms": { "type": "integer", "minimum": 10, "maximum": 2000 } } },
    "expose_as_tool": true, "scope": "device" }
] }
```

- 方法名规则：原生能力 `device.<name>`；插件 `plugin.<plugin_id>.<name>`（插件 SDK 自动加前缀）；Live2D 渲染方法沿用桌面 `RPC_METHODS_V1`（`state.get`、`model.motion.play`、`model.expression.set`、`model.param.batchSet`、`model.param.set`）及 `live2d.action.enqueue`，由 avatar host 实现，**不需要注册**。
- `expose_as_tool: true` 的方法由网关通过 `deviceHub.listToolMethods()` 暴露给 agent 核心（C5），工具名 = 方法名中 `.` 替换为 `_`，前缀设备简称：`<device_alias>__<method>`，如 `mi6__device_vibrate`。
- 网关调用设备：`rpc.req { method, params }`，默认超时 8 s。

### C1.7 麦克风上行

```
pub audio.input.start {stream_id, format:"pcm_s16le", sample_rate:16000, channels:1, mode:"push_to_talk"|"continuous", lang:"auto"}
pub audio.input.chunk {stream_id, seq, data_b64}          // 每块 100 ms（3200 字节 PCM）
pub audio.input.end   {stream_id, reason:"released"|"vad"|"cancel"}
```

网关拼接为 WAV 保存到 `~/yachiyo/data/device-audio/<stream_id>.wav`，调用 ASR（C4 中 `asr_*` provider；无 ASR 配置时回退到现有 `voice.asr_aliyun` 工具），推送 `audio.input.transcript {final:true}`，然后以设备会话执行 `runtime.run`（`input_audio` 字段沿用现有网关格式，`transcribed_text` 预填）。`reason:"cancel"` 不触发识别。

### C1.8 HTTP 辅助接口（网关）

所有接口要求 `Authorization: Bearer <pairing_token>` 或 `?token=`，localhost 来源免 token。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/device/pairing` | 仅 localhost：返回 `{token, urls:[ws://<lan-ip>:<port>/ws/device]}`，配置页生成二维码用 |
| GET | `/api/device/devices` | 在线设备列表 + `avatar_host` |
| POST | `/api/device/avatar/transfer` | `{to}` |
| GET | `/api/device/media/:id` | TTS 音频临时文件（10 分钟过期） |
| POST | `/api/device/plugins` | body 为 `.yplug` 二进制（`Content-Type: application/zip`），返回 `{sha256, manifest}` |
| GET | `/api/device/plugins` | 已上传插件列表 |
| GET | `/api/device/plugins/:sha256/blob` | 下载 |
| POST | `/api/device/plugins/:sha256/push` | `{target?: device_id}` 推送 `plugin.install`（默认所有 android 设备） |

---

## C2. Android JS Bridge

宿主页：`https://appassets.androidplatform.net/web/index.html`（主界面）与 `.../web/settings.html`（配置界面），由 `WebViewAssetLoader` 提供。

### C2.0 注入方式与防插件越权（统筹决策 2026-10-12）

Android 的 `addJavascriptInterface` 会把对象注入到页面**所有 frame**（含插件沙箱 iframe）。因此原生**只注入** `window.__YachiyoBridge`，它只有两个方法：

| 方法 | 说明 |
|---|---|
| `handshake()` | 每次页面加载（`onPageStarted` 重置）**只有第一次调用**返回随机 token（32 字节 hex），之后调用返回空串并记录告警 |
| `invoke(token, method, argsJson)` | `argsJson` 为参数数组的 JSON（如 `["avatar.*"]`）；token 不匹配返回 `{"error":{"code":-32006}}` 的 JSON 字符串；否则调用 C2.1 中同名方法并返回其字符串结果 |

Web 前端 `js/nativeShim.js` 必须是宿主页**第一个执行的脚本**（在任何 iframe 创建之前）：调用 `handshake()` 取得 token 并保存在闭包中，然后定义 `window.YachiyoNative`，其 C2.1 方法都转发到 `invoke(token, name, JSON.stringify(args))`。token 不得写入全局变量、不得通过 postMessage 发给插件。插件 iframe 是 opaque origin，无法读取宿主闭包，因此即使能看到 `__YachiyoBridge` 也无法调用。

其他：WebView 使用 `MIXED_CONTENT_ALWAYS_ALLOW`（宿主源为 `https://appassets…`，网关为局域网 `http://`）；导航仍限制在 `appassets.androidplatform.net`。网关对 `/api/device/*`、`/api/config/models*` 返回 CORS 头允许源 `https://appassets.androidplatform.net`。

WS4 实现细节（统筹确认）：`dispatch` 参数为对象 `{type, data}`（Web 端同时兼容字符串）；页面定义 `__yachiyoNative` 之前的消息进入 `window.__yachiyoQueue` 数组，前端定义后须清空处理；`plugins.changed` 的 data 为插件数组；`setConfig` 为深合并（数组整体替换）；新增 `dismissKeyguard()`（仅锁屏模式）；配置页由独立 `SettingsActivity` 加载 `/web/settings.html`。

### C2.1 Web → 原生：`window.YachiyoNative`（由 `nativeShim.js` 基于 C2.0 构造；参数与返回值均为字符串）

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getConfig()` | — | JSON | 完整配置（C2.3） |
| `setConfig(patchJson)` | JSON | `"ok"` / 错误 JSON | 浅合并，触发 `config.changed` |
| `getDeviceInfo()` | — | JSON | `{device_id, model, sdk, app_version, low_ram, total_mem_mb, is_default_launcher, mode}` |
| `hubState()` | — | JSON | `{state: disconnected\|connecting\|connected\|unauthorized, url, avatar_host, devices}` |
| `hubConnect()` / `hubDisconnect()` | — | — | |
| `hubPublish(topic, dataJson)` | | — | |
| `hubSubscribe(patternsJson)` / `hubUnsubscribe(patternsJson)` | `["avatar.*"]` | — | |
| `hubRpc(callId, method, paramsJson, target)` | target 可为空串 | — | 结果经 `hub.rpc.result` 事件返回 |
| `hubRpcRespond(reqId, resultJson, errorJson)` | 二选一，另一个传空串 | — | 回应网关发来的 `rpc.req` |
| `hubRegister(methodsJson)` / `hubUnregister(namesJson)` | C1.6 格式 | — | |
| `micStart(optionsJson)` / `micStop(reason)` | `{mode:"push_to_talk"\|"continuous"}` | — | 原生 AudioRecord 采集，直接经原生 WS 上行（C1.7） |
| `pickBackground()` | — | — | 系统选图，结果经 `picker.result {kind:"background", uri}`；原生将图片复制到 `files/backgrounds/` 并返回可加载 URL |
| `pickPluginPackage()` | — | — | 选 `.yplug`/`.zip`，原生安装后发 `plugins.changed` |
| `listPlugins()` | — | JSON 数组 | 每项：manifest + `{base_url, installed_at, enabled}` |
| `uninstallPlugin(id)` / `setPluginEnabled(id, bool)` | | | |
| `pluginStorageGet(pluginId, key)` / `pluginStorageSet(pluginId, key, valueJson)` | | | 每个插件独立 KV |
| `openHomeSettings()` | — | — | 跳系统默认桌面设置 |
| `listLaunchableApps()` | — | JSON 数组 | Launcher 应用抽屉：`[{package, label, icon_url}]`，`icon_url` 形如 `https://appassets.androidplatform.net/appicon/<package>.png` |
| `launchApp(package)` | | | 启动应用 |
| `setLockscreenEnabled(bool)` | | | 开关锁屏人物 |
| `setOrientation(mode)` | `auto\|portrait\|landscape` | | |
| `openSettings()` / `closeSettings()` | | | 打开/关闭配置界面 |
| `vibrate(ms)` | | | |
| `log(level, msg)` | | | 写入 logcat（tag `YachiyoWeb`） |

### C2.2 原生 → Web：`window.__yachiyoNative.dispatch(json)`

原生通过 `evaluateJavascript` 调用，参数为 `{ "type": "...", "data": {...} }`：

| type | data |
|---|---|
| `hub.state` | 同 `hubState()` |
| `hub.event` | `{ topic, data, from }` |
| `hub.rpc.request` | `{ id, method, params, from }`（网关调用本设备方法；live2d 方法由 Web 前端实现并 `hubRpcRespond`） |
| `hub.rpc.result` | `{ call_id, result?, error? }` |
| `mic.state` | `{ state: idle\|recording\|uploading\|error, stream_id?, error? }` |
| `mic.level` | `{ rms }`（0–1，约 20 Hz） |
| `config.changed` | 完整配置 |
| `plugins.changed` | 插件列表 |
| `picker.result` | `{ kind, uri?, url?, error? }` |
| `lifecycle` | `{ state: resume\|pause\|screen_off\|screen_on, mode: normal\|lockscreen }` |
| `back` | `{}` 返回键（Web 决定是否消费；未消费时 Web 调用 `YachiyoNative.log` 无需处理，原生在 300 ms 内未收到 `consumeBack()` 则执行默认行为） |

补充方法：`consumeBack()` —— Web 消费返回键。

**Web 侧在 `index.html` 加载早期必须定义 `window.__yachiyoNative = { dispatch(msg) {...} }`；原生在页面 `onPageFinished` 前到达的消息需排队。**

### C2.3 配置结构（SharedPreferences 中存为 JSON，键 `config`）

```json
{
  "server": { "host": "192.168.20.212", "port": 3000, "token": "", "auto_connect": true },
  "appearance": {
    "background": { "type": "color|image", "color": "#1d2233", "image_url": "" },
    "portrait_full_body": true,
    "landscape_focus": "upper_body",
    "model_quality": "auto|4096|2048"
  },
  "task_canvas": { "position": "top|bottom|left|right|hidden", "opacity": 0.85 },
  "audio": { "mic_mode": "push_to_talk|continuous", "volume": 1.0 },
  "launcher": { "enabled": false },
  "lockscreen": { "enabled": false },
  "orientation": "auto",
  "plugins": { "app_order": [], "widget_layout": [ { "id": "", "x": 0, "y": 0, "w": 2, "h": 1 } ] },
  "device": { "alias": "mi6" }
}
```

---

## C3. 插件包与插件 SDK

### C3.1 包格式

`.yplug` = zip（也接受 `.zip`），根目录：

```
manifest.json      必需
index.html         入口（可在 manifest.entry 指定）
icon.png           128×128 建议
...                任意静态资源（相对路径引用）
```

`manifest.json`：

```json
{
  "id": "com.example.pomodoro",          // 反向域名，[a-z0-9._-]{3,64}
  "name": "番茄钟",
  "version": "1.0.0",
  "type": "app",                          // app（横屏左侧入口，全屏打开） | widget（右侧桌面组件）
  "entry": "index.html",
  "icon": "icon.png",
  "description": "",
  "sdk": 1,
  "widget": { "w": 2, "h": 1, "min_w": 1, "min_h": 1, "max_w": 4, "max_h": 4 },  // 仅 widget，网格单位
  "permissions": [
    "bus.publish:plugin.com.example.pomodoro.**",
    "bus.subscribe:task.*",
    "rpc.call:avatar.*",
    "rpc.register",
    "agent.tool"                           // 允许把注册的方法暴露为 agent 工具
  ]
}
```

- 插件始终可以 publish/subscribe 自己的 `plugin.<id>.**`，无需声明。
- 安装位置：`files/plugins/<id>/`；服务 URL：`https://appassets.androidplatform.net/plugins/<id>/<path>`。
- 重复安装同 id：版本覆盖（保留 storage）。
- 锁屏模式下不加载任何插件。

### C3.2 宿主与插件隔离

- 插件在 `<iframe sandbox="allow-scripts allow-forms allow-pointer-lock">` 中运行（**无** `allow-same-origin`），不能直接访问 `YachiyoNative`。
- 插件与宿主通过 `postMessage` 通信，宿主校验 `event.source` 对应的插件 id 及权限后转发给原生 Bridge。
- app 类型：横屏时左滑出现入口，点击后在人物腾出的区域全屏/半屏打开（`orientation: landscape`）。
- widget 类型：右滑区域按网格布局，卡片内 iframe。

### C3.3 postMessage 协议

```json
{ "__yachiyo": 1, "kind": "req|res|event", "id": "<req 关联>", "op": "<操作>", "payload": {} }
```

### C3.4 SDK：`https://appassets.androidplatform.net/sdk/yachiyo-plugin-sdk.js`

```js
const y = await Yachiyo.ready();          // { pluginId, type, theme: {mode, accent}, locale }
y.bus.publish(topic, data);               // topic 需在权限内；简写：以 "." 开头表示插件私有，如 ".tick" → plugin.<id>.tick
const off = y.bus.subscribe(pattern, (data, meta) => {});   // meta: {topic, from}
await y.rpc.call(method, params, { target });                // 调用网关 / 其他设备方法
y.rpc.register(name, async (params) => result, { description, paramsSchema, exposeAsTool }); // 实际方法名 plugin.<id>.<name>
await y.storage.get(key); await y.storage.set(key, value);
await y.avatar.act({ type: 'emote', name: 'happy' });       // 便捷：live2d.action.enqueue
y.ui.close(); y.ui.setTitle(text);
y.widget.onResize(({ w, h, widthPx, heightPx }) => {});      // 仅 widget
```

### C3.5 电脑端推送

`node scripts/plugin-pack.js <dir> [-o out.yplug]` 打包；`node scripts/plugin-push.js <dir|file.yplug> [--target <device_id>] [--gateway http://localhost:3000]` 上传并推送（C1.8）。

---

## C4. 模型配置 schema v2 与 Model Catalog

### C4.1 `providers.yaml` v2（向后兼容 v1）

```yaml
version: 2
active_model: deepseek/deepseek-chat        # "<provider_key>/<model_id>"；缺省时取 v1 的 active_provider + 其 model
enabled_models:                              # 用户在 UI 中勾选的多个模型（切换器中出现）
  - deepseek/deepseek-chat
  - deepseek/deepseek-reasoner
  - qwen35_plus/qwen3.5-plus
roles:                                       # 可选：按用途指定模型
  chat: deepseek/deepseek-chat
  vision: qwen35_plus/qwen3.5-plus
  summary: deepseek/deepseek-chat
fallback_models: [qwen35_plus/qwen3.5-plus]  # 主模型失败（网络/5xx/429）时依次尝试
providers:
  deepseek:
    type: openai_compatible                  # openai_compatible | anthropic | google | tts_dashscope | asr_openai_compatible | asr_dashscope
    preset: deepseek                         # 可选，见 C4.3
    display_name: DeepSeek
    base_url: https://api.deepseek.com/v1
    api_key_env: DEEPSEEK_API_KEY            # 或 api_key
    headers: {}                              # 额外请求头
    timeout_ms: 60000
    max_retries: 2
    models:                                  # v2：一个 provider 多个模型
      - id: deepseek-chat
        name: DeepSeek V3
        context_window: 128000
        max_tokens: 8192
        reasoning: false
        input: [text]
      - id: deepseek-reasoner
        name: DeepSeek R
        reasoning: true
    model: deepseek-chat                     # v1 兼容：单模型写法，等价于 models: [{id: deepseek-chat}]
    compat:                                  # 已验证的协议差异
      supports_developer_role: false
      max_tokens_field: max_tokens           # max_tokens | max_completion_tokens
      reasoning_content_field: reasoning_content
      strip_reasoning_in_history: true
    extra_body: {}                           # 原样合并进请求体
```

### C4.2 Model Catalog API（`apps/runtime/config/modelCatalog.js`，CommonJS）

```js
const { loadModelCatalog } = require('../runtime/config/modelCatalog');
const catalog = loadModelCatalog({ store });   // store: ProviderConfigStore；不传则新建

catalog.models          // ModelDescriptor[]（所有 chat 模型，含未启用）
catalog.enabled         // ModelDescriptor[]（enabled_models 顺序；为空时 = [active]）
catalog.active          // ModelDescriptor
catalog.resolve(ref)    // 'provider/model' → ModelDescriptor | null
catalog.forRole(role)   // roles[role] → descriptor，缺省回退 active
catalog.fallbackChain() // [active, ...fallback_models] 去重
catalog.tts / catalog.asr  // 对应类型 provider 的规范化配置（无则 null）
```

`ModelDescriptor`：

```js
{
  ref: 'deepseek/deepseek-chat', provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek V3',
  api: 'openai-completions',          // openai_compatible→'openai-completions'；anthropic→'anthropic-messages'；google→'google-generative-ai'
  base_url: 'https://api.deepseek.com/v1', api_key: '<resolved or null>', api_key_env: 'DEEPSEEK_API_KEY',
  headers: {}, timeout_ms: 60000, max_retries: 2,
  context_window: 128000, max_tokens: 8192, reasoning: false, input: ['text'],
  compat: {}, extra_body: {}, temperature: null
}
```

`api` 取值与 pi-ai 的 API 标识保持一致；WS1 负责核对并在不一致时提出变更。

### C4.3 预设（`apps/runtime/config/providerPresets.js`）

至少包含：`openai`、`deepseek`、`qwen`（DashScope compatible-mode）、`moonshot`（Kimi）、`zhipu`（GLM）、`siliconflow`、`openrouter`、`ollama`（本地，无需 key）、`anthropic`、`gemini`、`custom`。每个预设提供 `type/base_url/api_key_env/models/compat` 默认值。

### C4.4 HTTP（网关，WS2 实现）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config/models` | `{active, enabled, roles, fallback_models, models:[descriptor 去掉 api_key，附 has_api_key]}` |
| PUT | `/api/config/models/selection` | `{active_model?, enabled_models?, roles?, fallback_models?}` |
| GET | `/api/config/models/presets` | 预设列表 |
| POST | `/api/config/models/test` | `{ref}` 或临时 provider 配置 → 发送一条最小请求，返回延迟与错误 |
| POST | `/api/config/models/discover` | `{provider}` → 调 `GET {base_url}/models` 列出可用模型 |

| PUT | `/api/config/models/providers/:key` | 新增/更新 provider（`api_key` 留空表示保留原值，`clear_api_key: true` 清除） |
| DELETE | `/api/config/models/providers/:key` | 删除 provider（被引用时 400） |

响应补充（WS2 实现，2026-10-12 统筹确认）：`GET /api/config/models` 中 `active` / `enabled` 为 ref 字符串，另含 `providers{}`（无密钥）；`/test` 返回 `{ok, latency_ms, status, error}`、`/discover` 返回 `{ok, models[]}`，上游失败时 HTTP 200 + `ok:false`；草稿 provider 只有在 `base_url` 与已存储 provider 一致时才继承其凭据。Descriptor `name` 为 `model.name || id`；`timeout_ms` 缺省 20000。

运行时切换模型：`runtime.run` 的 `params.model_ref`（可选）覆盖本次使用的模型；会话设置 `PUT /api/sessions/:id/settings {model_ref}` 持久覆盖。

---

## C5. Agent 核心（pi）集成点

- Agent 循环、上下文管理（含压缩）、技能、会话持久化由 `@earendil-works/pi-coding-agent` SDK 提供；代码位于 `apps/runtime/agent-pi/`。
- 入口：`createPiRuntime({ bus, executor, modelCatalog, deviceHub, personaContextBuilder, sessionStore, ... })`，向网关提供与旧 `ToolLoopRunner` 相同的 `run({ sessionId, input, inputImages, inputAudio, permissionLevel, modelRef, ... })` 语义，使 `RuntimeRpcWorker` / `runtime.run` 协议不变。
- 开关：环境变量 `AGENT_CORE=pi|legacy`（默认 `pi`；`legacy` 保留旧循环用于回滚）。
- **事件兼容**：pi 会话事件必须映射为现有 bus 事件，保证桌面/网页/手机客户端无需感知核心更换：`runtime.start`、`message.delta`（文本增量）、`llm.stream.*`、`tool_call.*`（requested / started / completed / failed）、`runtime.final`、`runtime.error`。具体字段以旧 `toolLoopRunner.js` 发出的为准，WS1 负责对齐并写测试。
- **工具注册**：
  1. `config/tools.yaml` 中的全部工具（含 live2d、voice、memory、persona、shell、fs、desktop perception）通过 `ToolExecutor` 包装为 pi 自定义工具；权限中间件、会话权限级别必须继续生效。
  2. Device Hub 中 `expose_as_tool` 的设备/插件方法：`deviceHub.listToolMethods()` → `[{ tool_name, device_id, method, description, params_schema }]`；调用：`deviceHub.invoke(device_id, method, params, { timeoutMs })` → Promise；变化通知：`deviceHub.on('tools.changed', fn)`。pi 侧在下一次请求前刷新工具集。
  3. 事件总线工具：`bus_publish {topic, data}`（限 `plugin.` `avatar.` `ui.` `task.` 前缀）。
  4. Avatar 工具：`avatar_transfer {to}`、`avatar_status`。
- **提示词迁移**：Persona（`SOUL.md`/`IDENTITY.md`/`USER.md` + persona profile）、`docs/memory_sop.md`、长期记忆 bootstrap、语音自动回复上下文、会话权限说明、技能列表，全部迁入 pi 的 system prompt / context files，内容与旧核心等价（测试比对关键段落）。
- **技能**：仓库 `skills/` 与 `~/yachiyo/skills` 作为 pi 技能目录；`config/skills.yaml` 的启用/禁用规则继续生效。
- **会话**：网关 `session_id` ↔ pi 会话文件一一对应，存放 `~/yachiyo/data/pi-sessions/`；`FileSessionStore` 继续写入供 UI 读取历史（或提供等价读取适配器，保证 `/api/sessions*` 不变）。
- **模型**：通过 C4.2 Model Catalog 生成 pi 模型（按 `api` 映射到 pi-ai 实现），支持 `fallbackChain()` 与 `params.model_ref`。

`apps/gateway/deviceHub/index.js` 导出 `getDeviceHub()`；Device Hub 未启用时返回空实现（`listToolMethods()` → `[]`，`invoke` → 抛 `-32010`）。

**Device Hub 服务端 API（统筹决策 2026-10-12，WS3 实现，WS1 / live2d adapter 调用）**：

| 成员 | 签名 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 空实现为 `false` |
| `getAvatarHost()` | `() => 'desktop' \| device_id` | 当前 avatar host |
| `listDevices()` | `() => [{ device_id, device_type, name, mode, alias, capabilities }]` | 在线设备 |
| `listToolMethods()` | `() => [{ tool_name, device_id, method, description, params_schema }]` | 见 C1.6 |
| `invoke(deviceId, method, params, { timeoutMs })` | `Promise<result>` | 设备 RPC；`deviceId` 可传 `'avatar-host'` 表示当前 host（host 为 desktop 时由调用方走原 17373 路径，hub 抛 `-32010`） |
| `requestAvatarTransfer(to, { reason })` | `Promise<{ transfer_id, host, status: 'completed'\|'failed', reason? }>` | `to` 为 `'desktop'` 或 device_id；按 C1.5 编排，Promise 在 completed/failed 时 resolve |
| `publish(topic, data, { target })` | `void` | 向设备投递事件（同时遵守 C1.4 桥接规则） |
| 事件 | `'tools.changed'`、`'devices.changed'`、`'avatar.host.changed'` | `EventEmitter` 事件 |

`model_ref`：`RuntimeRpcWorker` 透传 `params.model_ref` 与会话 settings 持久化 `model_ref` 由 WS2 实现；WS1 读取 run 参数中的 `model_ref`（优先）与会话 settings 中的 `model_ref`。`package-lock.json` 由统筹者在合并时统一重新生成。

---

## C6. Android 资源目录约定

```
apps/android/                                   Gradle 工程根（WS4）
  app/src/main/java/com/yachiyo/companion/...   Kotlin 原生（WS4）
  app/src/main/assets/web/                      Web 前端源码（WS5，入库）
    index.html, settings.html, css/, js/
    sdk/yachiyo-plugin-sdk.js
  app/src/main/assets/generated/                由 scripts/android-sync-assets.js 生成（gitignore）
    lib/pixi.min.js, lib/cubism4.min.js, lib/live2dcubismcore.min.js
    shared/live2dActionMessage.js, live2dActionMutex.js, live2dActionQueuePlayer.js, live2dActionExecutor.js, lipsyncViseme.js, lipsyncMouthTransition.js
    model/4096/..., model/2048/...              降采样后的模型
  sample-plugins/                               示例插件源码（WS5）
```

WebViewAssetLoader 路径映射（WS4 实现）：

| URL 前缀 | 来源 |
|---|---|
| `https://appassets.androidplatform.net/web/` | `assets/web/` |
| `https://appassets.androidplatform.net/generated/` | `assets/generated/` |
| `https://appassets.androidplatform.net/sdk/` | `assets/web/sdk/` |
| `https://appassets.androidplatform.net/plugins/<id>/` | `files/plugins/<id>/` |
| `https://appassets.androidplatform.net/user/` | `files/user/`（背景图等） |
| `https://appassets.androidplatform.net/appicon/<package>.png` | 运行时渲染的应用图标（PackageManager，内存缓存） |

## C7. 局域网服务端自动发现（2026-10-12）

配置页通过 Android NSD / DNS-SD 查找 `_yachiyo._tcp.`（mDNS local 域），不扫描整个 IP 网段。

- 网关在 HTTP server `listening` 后广播实际端口；实例名称默认为 `Yachiyo on <hostname>`，`YACHIYO_DISCOVERY_NAME` 可覆盖；重名由 Bonjour 协议处理。`YACHIYO_DISCOVERY_ENABLED=false` 禁用，默认启用。发布失败只影响发现功能，手动连接仍可用；退出、server close 时撤销广播并释放资源。
- TXT 仅含 `version=1`、`path=/ws/device`。不得包含 pairing token、API key、用户配置。发现仅提供连接候选，不代替配对认证。
- C2.1 新增 `startServerDiscovery()`、`stopServerDiscovery()`，立即返回；start 幂等；每次扫描最多 10 秒，Activity pause/destroy 自动停止并释放资源。锁屏与插件不能发起发现。
- C2.2 新增 `server.discovery.state`：`{state: scanning|stopped|error, reason?: manual|timeout|lifecycle|permission_denied|unavailable, error?: string}`。
- C2.2 新增 `server.discovery.results`：`{services:[{id,name,host,port,path,version}]}`，在发现、解析、丢失后发送完整快照；id 在本轮稳定。host 优先 IPv4，IPv6 不含 URL 方括号（构造 URL 时补方括号）；仅接受合法端口、version=1、path=/ws/device。
- 配置页提供扫描/停止、状态、结果列表和无结果说明，保留手动地址。选择候选填入 host/port；若地址或端口改变，清空旧 token 并提示输入新服务端配对令牌，避免把原服务端凭据发送给其他候选；同一地址可保留 token。不自动连接未知候选，也不自动信任 TXT 中额外字段。
- 设备网络不支持 multicast、权限未授予或服务端关闭时，显示可理解的失败/无结果状态，不能卡住配置页。
