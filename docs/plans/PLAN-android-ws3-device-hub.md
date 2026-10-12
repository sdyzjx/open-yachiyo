# WS3 施工文档：Device Hub（双工事件总线）+ 桌面移交 + 语音/麦克风路由 + 插件推送

> 类型: plan
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: PLAN-android-companion-contracts.md §C1 §C3.5 §C5

## 1. 目标

在电脑端网关实现 `/ws/device` 长连接 Device Hub：topic 发布/订阅、双向 RPC、设备注册与方法注册（供 agent 作为工具）、avatar host 状态机与移交编排、TTS 中继到手机、手机麦克风上行 ASR、插件存储与推送；桌面 Electron 作为 Hub 客户端参与移交动画并在非 host 时隐藏人物、不播放语音。

## 2. 负责路径

- 新增：`apps/gateway/deviceHub/**`（统筹者已提交 `index.js` 桩，保持 `getDeviceHub()` 导出与契约 C5 中的接口签名）
  - 建议拆分：`hub.js`（连接、信封、订阅匹配、RPC）、`topics.js`（通配匹配）、`avatarHost.js`（状态机 + 持久化）、`runtimeBridge.js`（bus ↔ hub 桥接、`message.delta`/`runtime.final`→`chat.*`、tool_call→`task.update` 聚合）、`voiceRelay.js`、`audioInput.js`（PCM→WAV + ASR）、`asrService.js`、`pluginStore.js`、`httpRoutes.js`、`config.js`（`device-hub.yaml`、token 生成）
- 修改：`apps/gateway/server.js`（**仅**在 `wss` 创建附近增加 `attachDeviceHub({ server, app, bus, ... })` 一处调用；注意 `/ws` 现有 `WebSocketServer({server, path})` 与新路径共存需改为 `noServer` + `upgrade` 分发，改动保持局部）
- 修改：`apps/runtime/tooling/adapters/live2d.js`（当 avatar host 不是 desktop 时，RPC 经 `getDeviceHub().invoke(host, method, params)` 路由到手机；其余不变）
- 修改：`apps/desktop-live2d/**`（Electron 主进程连接 Hub、移交动画、非 host 隐藏与静音、托盘菜单「把八千代送到手机/接回电脑」）
- 新增：`scripts/plugin-pack.js`、`scripts/plugin-push.js`（纯 Node 实现 zip 打包，可用 `zlib.deflateRawSync` 写最小 zip；或添加依赖 `yazl` / `yauzl`，需在交付记录说明）
- 新增：`apps/gateway/public/devices.html|js|css`（电脑端设备页：配对二维码/地址、在线设备、avatar host 切换按钮、插件上传与推送）
- 测试：`test/gateway/deviceHub/**`

不得修改：`apps/runtime/agent-pi/**`、`apps/runtime/config/**`（ASR provider 配置通过 `modelCatalog.asr` 只读获取；若 WS2 尚未合并，用 `providers.yaml` 原始读取做兼容）、`apps/android/**`。

## 3. 任务与提交点

| # | 任务 |
|---|---|
| 1 | Hub 核心：鉴权、hello/welcome、心跳、sub/unsub（`*` / `**` 通配）、pub 路由、定向投递、`rpc.req/res` 双向（超时、目标离线 `-32010`）、`rpc.register` 与 `listToolMethods()` / `invoke()` / `tools.changed` 事件；锁屏模式权限；`/ws` 与 `/ws/device` 共存 |
| 2 | runtime bus 桥接（契约 C1.4 桥接规则）；`chat.input` → 设备会话 `runtime.run`；`chat.delta/final`；`task.update` 聚合 |
| 3 | Avatar host 状态机 + 移交编排（契约 C1.5，含超时/失败/持久化）+ HTTP `POST /api/device/avatar/transfer`；`ui.live2d.action` 与 live2d RPC 按 host 路由（修改 `live2d.js` adapter） |
| 4 | 桌面 Electron：作为 Hub 客户端（`device_type=desktop`），实现 prepare/exit/enter 动画（契约 C1.5 动画规范）于渲染进程（建议新文件 `renderer/avatarTransfer.js`，最小侵入 `bootstrap.js`），非 host 时隐藏模型并跳过 `voice.requested` 处理；托盘菜单项 |
| 5 | 语音中继：host 为手机时由网关处理 `voice.requested`：调用现有 `QwenTtsClient.synthesizeNonStreaming`（或抽到共享位置）合成，存入媒体临时目录，向 host 发 `voice.play`；`GET /api/device/media/:id` |
| 6 | 麦克风上行：`audio.input.*` → WAV → ASR（`asr_openai_compatible`：`POST {base_url}/audio/transcriptions` multipart；`asr_dashscope`；回退 `voice.asr_aliyun` 工具）→ `audio.input.transcript` → 以设备会话执行 run |
| 7 | 插件存储/推送：HTTP 接口（契约 C1.8）、`plugin.install` 事件、回执；`scripts/plugin-pack.js` / `plugin-push.js`；校验 manifest（契约 C3.1） |
| 8 | 电脑端设备页 `devices.html`（含配对二维码：可用纯 JS 二维码库内联或简单显示 URL + token） |
| 9 | 文档：`docs/features/FEAT-device-hub.md`、`FEAT-device-hub-avatar-transfer.md`、`FEAT-plugin-push.md`；`docs/modules/gateway/device-hub.md`；`docs/testing/TC-device-hub.md`（`TC-HUB-001…`）、`TC-avatar-transfer.md`（`TC-AVT-001…`）；`npm run docs:index` |

每项完成即 commit。

## 4. 测试要求

- 用真实 `ws` 客户端在测试中连接 `/ws/device`：鉴权失败、订阅通配、定向投递、RPC 双向与超时、离线目标、锁屏拒绝 plugin、方法注册 → `listToolMethods()`
- 移交：两个假设备完成完整时序；目标不 ready → failed 且 host 不变；状态持久化重启后恢复
- 桥接：bus 发布 `ui.live2d.action` 只到 host；`message.delta` → `chat.delta`
- 音频：给定 PCM 块 → 生成合法 WAV 头；ASR mock 服务器 → transcript 事件
- 插件：上传合法/非法 manifest；push 事件内容
- 现有 507 个测试不回归（尤其 `/ws` e2e）

## 4.1 实施进度

- 任务 1 完成：Hub 核心、HTTP 鉴权基础与双 WS upgrade 分发；`npm run test:ci` 513/513 通过。

- 任务 2 完成：runtime bus 双向桥接、设备会话入队与任务聚合。

- 任务 3 完成：host 持久化、移交状态机、HTTP/RPC 与 live2d adapter 路由。采用 C1.5 失败条款的 prepare 8 秒；其余步骤 4 秒超时继续。

## 5. 待统筹决策

## 6. 交付记录
