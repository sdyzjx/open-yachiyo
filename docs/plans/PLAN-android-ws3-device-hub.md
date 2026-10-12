# WS3 施工文档：Device Hub（双工事件总线）+ 桌面移交 + 语音/麦克风路由 + 插件推送

> 类型: plan
> 状态: done
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

- 任务 4 完成：桌面 Hub 客户端、动画、host 可见性/语音门控与托盘入口。动画视觉效果需统筹者桌面实机验收。

- 任务 5 完成：复用 Qwen TTS 的手机语音中继、媒体授权下载和过期清理。

- 任务 6 完成：PCM/WAV、两类 ASR、权限保留的工具回退、转录后设备会话执行。

- 契约同步：工作期间检测到统筹者外部更新 C5，已补齐 alias、requestAvatarTransfer、avatar-host 与状态变化事件；不提交该外部契约文件。

- 任务 7 完成：纯 Node ZIP/manifest 校验、插件持久存储、推送/回执与打包/推送 CLI；没有新增依赖。

- 任务 8 完成：设备页 `/devices.html`，配对 URL/token、在线状态、移交、插件上传/推送与错误提示。Chrome 离线假设备验证手机/桌面往返，页面 host 与按钮状态正确；全量 526/526 通过。

- 收尾回归：修复桌面装配初始化顺序，补充完整启动/停止、动画/语音取消竞态、锁屏在途 RPC、远程 HTTP 权限；补齐旧 runtime done → chat.final 去重。

- 任务 9 完成：三份功能文档、Gateway 模块文档、Hub/Avatar 自动与手工 TC、文档索引已补齐。

## 5. 待统筹决策

- C1.7 transcribed_text 透传：现有 `server.js::normalizeInputAudio` 与 `runtimeRpcWorker.js::normalizeInputAudio` 会移除此字段，非空 input 路径也未注入 runtime_context.input_audio。WS3 已按契约传入该字段并以识别文本作 input，保证不重复识别；请 WS1/统筹者保留该字段并注入 context/历史元数据。受负责路径限制未修改这些规范化段。

## 6. 交付记录

### 完成项

任务 1～9 已按顺序实现并独立提交：Hub 核心、runtime 桥接、Avatar 状态机、桌面接入/动画、手机语音中继、麦克风/ASR、插件包/推送、设备页、功能/模块/测试文档。另有统筹新增 C5 API 同步和收尾竞态修复提交。

- 工作目录：`/Volumes/data/Users/Programming/yachiyo-wt/ws3-device-hub`；分支：`agent/ws3-device-hub`。
- `server.js` 仅修改原 wss 创建附近两行；package.json/package-lock.json 均未修改，新增依赖为零。
- 未 push、未合并其他分支、未修改其他 worktree，未使用 Android 设备，未提交密钥或构建产物。
- 工作期间统筹者在本 worktree 外部更新契约 C5；WS3 读取并对齐实现，但**未修改、未暂存、未提交该契约文件的外部 diff**。交付时该文件仍会出现在 git status，供统筹者处理。

### 提交清单

所有下列提交均包含指定 Co-Authored-By trailer；每次提交前已运行 `npm run test:ci`。

| 任务 | 提交 | 验证 |
|---|---|---|
| 1 Hub 核心与 WS 共存 | `35d331f` | 513/513 |
| 2 runtime 桥接与设备会话 | `d660ddd` | 514/514 |
| 3 Avatar 状态机与路由 | `4bea6f5` | 516/516 |
| 4 桌面 Hub/动画/托盘 | `03ca0c6` | 518/518 |
| 5 手机 TTS 与媒体 | `cd24b7a` | 519/519 |
| 6 PCM/WAV 与 ASR | `a81f18a` | 521/521 |
| 统筹 C5 API 补齐 | `fb051b1` | 522/522 |
| 7 插件包/存储/CLI/推送 | `bf1b815` | 524/524 |
| 8 设备页 | `41dccd1` | 526/526；Chrome 离线假设备往返 |
| 收尾启动/竞态/鉴权回归 | `364e442` | 533/533 |
| 9 功能/模块/测试文档与索引 | `08e6bd9` | 533/533；docs:index；JS 语法检查 |

本交付记录作为最后的 `docs(device-hub)` 提交；其提交号可用 `git log -1 --format=%h -- docs/plans/PLAN-android-ws3-device-hub.md` 查询，避免在提交内容中自引用尚不存在的哈希。

### 未完成项与待集成

- WS3 负责的实现任务无剩余。C1.7 的 `transcribed_text` 在旧 gateway/worker 规范化后丢失，属于跨负责路径修改，已在「待统筹决策」明确说明。当前以识别文本作为 input 可正常执行设备对话，不会再次 ASR；历史/context 音频元数据完整性仍需 WS1/统筹者修复。
- 真机/真实云端验收未执行：TC-AVT-009、TC-HUB-016、TC-HUB-017 由统筹者在合并 WS1/WS2/WS4/WS5 后执行。

### 已知风险与限制

- Electron 动画时长、回执和装配经过离线测试；透明窗口视觉效果、真实 TTS 口型、Android 安装行为仍需实机联调。浏览器设备页已用假设备验证来回移交。
- 单桌面假设；离线 host 不自动回桌面；损坏的 state.json 需要运维处理。桌面现在依赖 Hub 握手确定可见性，无法连接 Hub 时保持隐藏/静音。
- ASR DashScope 支持 Qwen inline WAV 短音频接口；不支持 Paraformer 的异步 URL 任务。录音文件与插件包无自动保留上限，运维需清理；TTS 媒体 10 分钟自动过期。
- 默认 HTTP/WS 与 pairing token 面向可信局域网；公网部署需 TLS。插件细粒度权限/安装由 Android 插件宿主执行。
- 设备页按任务允许的 URL + token 简化配对，不生成二维码；旧首页未增加链接，可直接打开 `/devices.html`。

### 如何验证

```sh
node --version  # 本次 v24.10.0
node --test test/gateway/deviceHub/*.test.js
npm run test:ci
npm run docs:index
git diff --check
```

全量最终结果：533 tests / 533 pass / 0 fail / 0 skip。新增测试只使用本机随机端口、固定测试 token、mock TTS/ASR、临时文件和假 Electron/设备，不依赖云端或真实硬件。

启动网关后打开 `http://localhost:3000/devices.html`；按 TC-AVT-009 / TC-HUB-016 / TC-HUB-017 执行真实跨端验收。完整接口和路径说明见 [device-hub.md](../modules/gateway/device-hub.md)。
