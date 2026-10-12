# Android Companion 停止交接记录

> 类型: handoff
> 状态: done
> 负责人: ui_integration_review agent
> 更新: 2026-10-13
> 关联: ../plans/PLAN-android-companion.md, ../plans/PLAN-android-companion-contracts.md, ../experiments/EXP-20261013-android-mouth-neutral.md, ../experiments/EXP-20261012-companion-integration-acceptance.md

## 恢复后闭环状态（2026-10-13）

本交接所列 Android presence/UI、Desktop D1、配置 WebUI 安全与 ChatGPT plan 后端候选均已在当前主线基线上完成独立审查与整合。下文保留为停止时的历史快照，其中“未合并 checkpoint”和“恢复顺序”不再代表当前执行状态。

- Desktop D1 与紧凑布局打磨已合入；仍需 macOS 最终人工视觉验收。
- Android B1/B6/B8/B9、迁移 HUD 与完整模型 bounds 约束已合入；最终 bounds 仍需小米 6 真机视觉复核。本轮闭环没有安装 APK、调用设备或发起 transfer。
- ChatGPT OAuth/OIDC、凭据存储、模型目录与 Responses 后端已合入；Desktop Continue with ChatGPT UI、真实 OAuth 与真实 Responses 调用仍未验收。
- A15 / 60 FPS 已按用户决定放弃，不再恢复。B3 抽动修复保留，旧 Worker/VBO/physics/mask 性能候选没有进入主线。
- 闭环集成通过隔离 `HOME/TMPDIR` 的 Node 789/789、文档 lint，以及 JDK 17 Android 单测与 debug APK 构建（41 tasks）。

## 停止范围

用户在 2026-10-13 明确要求停止当前开发并保存完整交接。停止后没有继续合并功能、调用真实 OAuth/API、执行 avatar transfer、安装 APK 或运行设备验收。本文件记录停止时已存在的代码、证据与运行态；标为 WIP 的内容均不能视为交付完成。

恢复后的优先级：先解决 Android presence 闪现并做稳定观察，再审查 Desktop/Android 主界面迁移控件；随后封住配置管理 API 的远程访问与响应泄密，再实现结构化配置 WebUI；ChatGPT OAuth/Responses 在上述 UI 与安全契约稳定后重放合并；60 FPS 与身体抽动继续保持独立阻塞项。

## 主线状态与已合提交

主仓库 `/Volumes/data/Users/Programming/yachiyo-android` 位于 `feature/android-companion`，停止前 HEAD 为 `d2d606bd3c5c0adb4349dc61225ecbc5b9b6049c`，工作树 clean。自 UI 基线 `3f23233` 之后主线映射如下：

| 来源提交 | 主线提交 | 内容 |
|---|---|---|
| `08f3198` | `74aae6e` | Android 夜景、静态背景与静态高斯玻璃 |
| `2958a90` | `03c1828` | Desktop 夜景 UI 与模型选择器 |
| `1169fd3` | `4c2401e` | Android 移除模型、Provider 与密钥配置职责 |
| `05eebd3` | `6150bf6` | Desktop 模型 IPC 首启注册竞态 |
| `7e99c43` | `d367287` | UI 验收文档 |
| 独立审查修复 | `8ad8b31` | Desktop 模型 IPC 请求精确 allowlist 与响应/错误脱敏 |
| `251b1b2` | `f344cc2` | 音频证据与 realtime TTS 设计 checkpoint |
| 独立审查记录 | `5969e93` | UI 集成审查与未通过项 |
| `ecdfb6b` | `59a805d` | 静音口型恢复中性参数 |
| `57d6cd4` | `000c504` | 口型真机实验记录 |
| 集成记录 | `3bd0344` | 口型修复主线集成状态 |
| `a900418` | `d2d606b` | 验收期间 ownership 副作用与真实 transfer 证据 |

主线最后一次产品代码验证为隔离 `HOME`/`TMPDIR` 的 Node 667/667 通过，以及 JDK 17 `:app:testDebugUnitTest :app:assembleDebug` 通过（41 tasks）；之后只有文档提交 `3bd0344`、`d2d606b`。UI 批次此前独立验证为 Node 665/665 与相同 Android 两任务通过。

## 未合并 checkpoint

### Android presence 与迁移主界面

`agent/ui-transfer-controls` 位于 `/Volumes/data/Users/Programming/yachiyo-wt/ui-refresh`，停止 checkpoint HEAD `5d59805`，工作树 clean。

- `d3d526a fix(android): keep authoritative avatar owner on reconnect` 修复手机偶发“窜出来又消失”：旧 `isHost()` 在断线或 owner 未知时默认 true，造成实际 owner 为 desktop 时手机短暂显示；重连后收到 `avatar_host=desktop` 才隐藏。修复改为保留最后一次权威 owner，首次 unknown 保持隐藏，普通 `hub.state` 不再触发 enter 动画。
- 聚焦 `node --test test/android-web/avatarOwnerState.test.js` 为 3/3 通过，语法检查和 `git diff --check` 通过。全量 Node 共 672：670 pass、1 fail、1 cancelled；失败来自 `companion.e2e` after-hook 临时目录 `ENOTEMPTY` 与 pending Promise，收到停止指令后未重跑。
- 此 hotfix 未合主、未执行 Android 构建、未安装真机，也没有改变当前 owner。恢复时先独立 review/cherry-pick `d3d526a`，跑隔离全量 Node 与 Android 两任务，再由 UI 工作流保持 owner=desktop、不发 transfer，USB 安装后稳定观察至少 15 秒。
- 预审时曾发现拟议 transfer event guard 会在 `onPrepare` 模型加载失败后永久保留 pending，以及 cancel resolve 被中断 enter 后仍可能发送 `avatar.transfer.entered`。这些 guard 改动已从保存代码完全移除；当前仍为 legacy transfer 行为，未来若重做必须单独设计异步取消测试。
- `5d59805 chore(wip): checkpoint avatar transfer controls` 保存未审查草稿：Android/Desktop 主界面迁移按钮与状态、IPC、Tray/Dock、角色右键菜单、带标准窗口框架的 Chat/Settings shell，以及草稿测试/文档。没有 macOS 视觉验收、Android 构建、真机或真实 transfer 验收，不得直接合主。施工记录见该分支 `docs/plans/PLAN-device-hub-avatar-transfer-controls.md`。

用户期望仍是：Desktop 与 Android 主界面均有常驻切换入口、目标离线/未知时明确禁用并显示原因、多 Android 时明确选择；Desktop 恢复可见状态栏图标与 Dock 配置/召回入口，角色单击切换聊天、右击隐藏/迁移，Chat 使用标准 macOS traffic lights，只有 desktop owner 且角色可见时展示聊天，左下角小尺寸入场，并继续保留聊天模型选择器。

### 配置 WebUI

`agent/config-ui-rebuild` 位于 `/Volumes/data/Users/Programming/yachiyo-wt/config-ui-rebuild`，HEAD `5db6a917c0df6dcd4eef6d8f34a308d0d01956c9`，clean。仅新增方案 `docs/plans/PLAN-gateway-config-ui-rebuild.md` 与索引，产品代码零修改；执行了 `npm run docs:index` 和 `git diff --check`，未运行产品测试。

现有真实链路：Chat 使用 `ProviderConfigStore` 的 `active_model`、`enabled_models`、roles 与 fallback；TTS 使用 `TTS_PROVIDER_KEY || qwen3_tts` 下的 `tts_model`、`tts_voice`、`tts_realtime_model`、`tts_realtime_voice`，Desktop 另由 `desktop-live2d.json` 的 `voice.path/voice.transport` 决定 realtime/nonstream；ASR 从首个 ASR provider 读取 `model || asr_model`。手机仍必须是纯客户端，不提供任何模型、Provider 或密钥配置。

恢复前的安全阻断：`apps/gateway/deviceHub/accessControl.js` 仍把 `/api/config/models*` 加入 Android appassets CORS，全局 pairing token 可访问远程 `/api`；`apps/gateway/routes/modelConfig.js` 的 snapshot 只去掉顶层 `api_key`，仍返回 `headers`、`extra_body`、`api_key_env` 等字段。下一提交必须让整个 `/api/config/**` 依据真实 `req.socket.remoteAddress` 仅允许 loopback，拒绝 pairing token/XFF 绕过，移除 models appassets CORS，并把 provider snapshot 改为 safe shape；Provider PUT 必须 patch 并保留未出现的 secret/advanced 字段，只有显式 clear 才删除密钥。

### ChatGPT OAuth / Responses

`agent/chatgpt-plan` 位于 `/Volumes/data/Users/Programming/yachiyo-wt/chatgpt-plan`，HEAD `95260eeb10bb217236b3dd09b255761b4afce0f0`，clean。候选链未合主：

1. `111c933`：ChatGPT plan 合同与施工计划。
2. `5b8f67f`：OAuth/OIDC/token store、ChatGPT provider、Responses 适配。
3. `f99f2d2`：删除 authorization URL 的 ID token、loopback Host/Origin/Fetch-Metadata 门禁、同步 pending reservation/清理、refresh 忽略新 ID token、多 audience `azp`、Responses namespace 工具结果回放。
4. `95260ee`：只要 `azp` 存在就必须等于 client ID；多 audience 必须带 `azp`。

作者证据为聚焦 auth 10/10、相关修复批次 48/48、隔离全量 Node 677/677；独立审查确认最后一项 `azp` 阻断已修，但停止前未在当前主线重放、未解决文档/config UI 冲突，也未做真实 OAuth/API。恢复时逐提交 cherry-pick 并人工保留当前 UI、口型、验收文档；不能把旧分支相对基线的大范围删除带回主线，也不能宣称 ChatGPT 真账号已通过。

## 真机、渲染与语音证据

- 口型修复 APK SHA-256 为 `72534098c5db74be7ec7299a040ef0e774ebc623cdfc6c896cc7abcbc2a66532`。USB 小米 6 上静音 15 秒 466 次真实 `beforeModelUpdate` 均为 OpenY/Form 0/0；18 秒参考音频范围 OpenY 0–0.9976、Form -0.6899–0.0311；结束后 3 秒 94 次更新均为 0/0。Greet/ReactError 未单独真机触发，只由相同代码路径、资源审计与自动化覆盖。
- A15 未通过。页面时钟暖机样本为 55.96 draw FPS（561 帧/10.0247 秒，均值 16.34 ms、p95 20.30 ms）；身体抽动也未验收通过。设备性能阶段约 45–46°C、处于充电状态，早先电量 27%，不能作为最终基准。
- `7ff5774` 的共享 mask 局部 dirty 优化不安全：mask FBO 每次 draw 会整张 clear，只重绘变化 source 会丢失同一共享 FBO 中未变化 source。该提交已由 `bb4a197` 撤销，未安装、未合主。`48a574b` 等 Worker/VBO/physics 性能候选同样未合主。
- 物理扬声器在系统媒体音量 17/25、应用音量 1 下由用户确认正常；realtime TTS 仍是设计 checkpoint，真实讲话 ASR→pi 回复没有完成。不要重试已遇到欠费的真实 API 或更改用户账单。

## 停止时运行态与设备状态

- 隔离 Gateway 仍由 PID 13921 运行：`127.0.0.1:3002`，`YACHIYO_HOME=/tmp/yachiyo-companion-acceptance`。Electron 入口 PID 13957、应用 PID 13958，RPC `127.0.0.1:17374`，remote debugging `127.0.0.1:9224`。这些是用户正在看的运行实例，停止时没有关闭。
- 停止前只读 `/api/device/devices` 显示 Desktop 与 Android 均在线，权威 `avatar_host=desktop`；01:22:58 完成的 transfer 后日志没有新的 `host.changed`/transfer。Desktop 角色窗口与聊天此前已分别通过 CUA 目视确认可见，但交接时没有重新触发 transfer 或窗口动作。
- 小米 6 USB 序列号 `ca1e5d8b`，型号 MI 6 / sagit，USB 调试已由用户授权。设备互斥锁状态为 `free`。测试结束时媒体音量 17/25、自动旋转 `1`、用户旋转 `0`；官网 2400×1440 宫殿夜景已通过 DocumentsUI 导入 App 私有 `files/user/backgrounds/`，强停重启后保持，素材未进 Git。
- 用户报告的手机短暂入场/消失期间，服务器 owner 始终为 desktop，且没有周期测试脚本运行；这是客户端断线显示竞态，不是合法 transfer。后续必须遵守“一次用户明确动作对应一次迁移”，配置页打开、渲染初始化、lifecycle resume 与 reconnect 都不得迁移。

## Worktree 清单

| worktree / branch | HEAD | 停止状态 |
|---|---|---|
| 主仓库 `feature/android-companion` | `d2d606b` | clean；本交接提交前 |
| `android-integration` / `agent/realtime-tts` | `251b1b2` | clean；文档已映射进主线 `f344cc2` |
| `android-mouth-fix` / `agent/android-mouth-fix` | `a900418` | clean；代码/文档已映射进主线 |
| `chatgpt-plan` / `agent/chatgpt-plan` | `95260ee` | clean；未合 |
| `config-ui-rebuild` / `agent/config-ui-rebuild` | `5db6a91` | clean；仅计划，未合 |
| `ui-refresh` / `agent/ui-transfer-controls` | `5d59805` | clean；`d3d526a` hotfix + 未审查 WIP，未合 |
| `ui-review` / `agent/ui-review` | `5969e93` | clean；审查基线 |
| `ws1-pi-completion` / `agent/ws1-pi-completion` | `d476836` | clean；旧性能 checkpoint |
| `ws1-pi-core` / `agent/ws1-pi-core` | `7d4419a` | **dirty**：仅 `docs/plans/PLAN-android-companion-contracts.md` |
| `ws2-llm-models` / `agent/ws2-llm-models` | `63504a1` | clean |
| `ws3-device-hub` / `agent/ws3-device-hub` | `153186c` | **dirty**：仅 `docs/plans/PLAN-android-companion-contracts.md` |
| `ws3-integration` / `agent/ws3-integration` | `61bbc1d` | clean |
| `ws4-android-native` / `agent/ws4-android-native` | `391ab63` | clean |
| `ws5-android-web` / `agent/ws5-android-web` | `6ea2867` | clean |

旧 WS1/WS3 的 dirty 契约文件在停止时原样保留，未覆盖、未清理；恢复前先比较其内容与主线唯一事实来源，不能直接合入。任何分支中的凭据、隔离运行目录和构建产物都不得提交。

## 恢复顺序

1. 确认主线 clean、隔离服务仍指向 `/tmp/yachiyo-companion-acceptance`、设备锁 free；不要自动 transfer。
2. 独立审查 `d3d526a`，跑隔离 Node 与 JDK 17 Android 两任务；安装后在 `avatar_host=desktop` 下观察手机至少 15 秒，确认始终隐藏且没有 enter 动画。
3. 逐文件审查 WIP `5d59805`，拆成功能提交；补 macOS Tray/Dock/traffic lights/Settings 与 Android/多设备按钮的行为、视觉和离线测试，真实 transfer 只在用户明确触发时执行。
4. 先完成整个 `/api/config/**` loopback-only、CORS 收窄、safe snapshot 与 patch 语义，再按 `5db6a91` 的 IA 实现统一模型/TTS/ASR WebUI；手机继续没有模型配置。
5. 在当前主线逐提交重放 ChatGPT 候选并重新审查；只做 mock 测试，获得用户后续授权前不做真实 OAuth/API。
6. 最后单独恢复性能工作；任何 mask/Worker/VBO 候选必须同时证明共享 mask 正确、动作连续、口型不回归与 60 FPS，不能用低频截图替代逐帧稳定性。
