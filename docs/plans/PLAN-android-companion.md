# Yachiyo Android Companion + pi Agent Core 总体施工计划

> 类型: plan
> 状态: active
> 负责人: codex-coordinator
> 更新: 2026-10-13
> 关联: PLAN-android-companion-contracts.md, EXP-20261012-android-live2d-webview-feasibility.md, 各 PLAN-android-ws*.md

## 当前集成状态（2026-10-13）

- Desktop D1 外壳、标准聊天窗及紧凑布局打磨已完成代码集成；macOS 最终人工视觉验收仍需统筹者执行。
- Android B1/B6/B8/B9、统一主题、迁移 HUD 与完整模型 bounds 几何约束已完成代码和自动化整合；最终 bounds 仍需小米 6 真机视觉复核。本次最终集成不安装 APK、不触发 transfer。
- ChatGPT plan 后端（OAuth/OIDC、凭据存储、账户模型目录、统一模型选择、Responses 适配）已合入；Desktop Continue with ChatGPT UI、真实账户 OAuth 与真实 Responses 调用尚未验收。
- A15 / 60 FPS 已按用户决定放弃，不再列为阻塞或恢复项。B3 身体抽动已有逐帧修复证据；Worker/VBO/physics/mask 等历史失败性能候选保持未合入。
- 仍需完成的产品验收只包括上述 macOS 视觉、Android 最终 bounds 真机视觉，以及 ChatGPT UI/真实账号链路；不得把 mock 自动化结果表述为真实 OAuth/API 通过。
- 当前集成在隔离 `HOME/TMPDIR` 下通过 Node 789/789 与文档 lint；JDK 17 Android 单测和 debug APK 构建通过（41 tasks）。

## 1. 目标

1. 把 Live2D 桌宠移植到 Android（WebView 渲染，见实验文档结论）。
2. Agent 仍运行在电脑端；手机通过 Wi-Fi 与电脑端网关保持 WebSocket 长连接，在其上实现 **Device Hub 事件总线**（topic 发布/订阅 + 双向 RPC）。
3. Yachiyo 可以在电脑与手机之间**移交**：从一台设备屏幕下方离开，再从另一台设备下方出现。
4. 手机端：音频播放（TTS）、麦克风输入；竖屏全身 + 可自定义背景；横屏聚焦上半身，左滑露出插件入口，右滑露出桌面组件；动效丝滑。
5. 插件系统：JS + HTML5 小程序（横屏打开）与桌面组件，统一 `.yplug` 包格式，手机可直接导入，电脑端可推送；插件可访问事件总线并注册接口（可暴露为 agent 工具）。
6. 手机统一配置界面：服务端地址、背景、任务画布位置、插件导入、默认桌面接管、锁屏显示人物（锁屏下 agent 可控制人物、麦克风与音频，但不能访问插件）。
7. 模型配置升级：支持 DeepSeek 等多种 API、多模型选择、按用途分配、失败回退；配置与凭据只在电脑端管理，手机保持纯客户端职责。
8. **Agent 核心迁移到 pi**（`@earendil-works/pi-coding-agent`）：循环、上下文管理、技能、会话都由 pi 承担；现有工具、事件总线、设备 RPC、音频功能注册为 pi 工具；现有 prompt 迁移到 pi。

## 2. 架构总览

```mermaid
flowchart LR
  subgraph PC[电脑端]
    GW[Gateway<br/>/ws  /ws/device  HTTP]
    PI[pi Agent Core<br/>loop · context · skills · sessions]
    TOOLS[Tools<br/>live2d · voice · memory · shell · perception]
    BUS[(RuntimeEventBus)]
    HUB[Device Hub<br/>pub/sub · RPC · avatar host · voice relay · ASR · plugin store]
    EL[Electron Live2D<br/>hub client]
    CAT[Model Catalog<br/>providers.yaml v2]
    GW --- PI
    PI --> TOOLS
    PI --> CAT
    PI <--> BUS
    BUS <--> HUB
    HUB <--> EL
    PI -. device tools .-> HUB
  end
  subgraph PHONE[Android]
    NAT[Kotlin 原生壳<br/>WS 前台服务 · 麦克风 · 插件安装 · Launcher · 锁屏]
    WEB[WebView 前端<br/>Live2D stage · 手势布局 · 插件宿主 · 配置页]
    PLG[插件 iframe<br/>SDK]
    NAT <--> WEB
    WEB <--> PLG
  end
  HUB <== Wi-Fi WebSocket ==> NAT
```

## 3. 工作流划分

| 工作流 | 执行者 | 分支 / worktree | 负责路径 | 施工文档 |
|---|---|---|---|---|
| WS1 Agent 核心迁移到 pi | Codex（gpt-6-astra，high，priority） | `agent/ws1-pi-core` | `apps/runtime/agent-pi/**`，`apps/gateway/server.js` 中 agent 装配段，`test/runtime/agent-pi/**`，`package.json` 依赖 | PLAN-android-ws1-pi-core.md |
| WS2 模型配置 v2 | Sonnet 5.5（medium） | `agent/ws2-llm-models` | `apps/runtime/config/**`，`apps/runtime/llm/**`，`apps/gateway/routes/modelConfig.js`，`apps/gateway/public/config-v2*`，`test/runtime/config/**` | PLAN-android-ws2-llm-models.md |
| WS3 Device Hub + 桌面移交 | Codex（gpt-6-astra，high，priority） | `agent/ws3-device-hub` | `apps/gateway/deviceHub/**`，`apps/desktop-live2d/**`，`apps/runtime/tooling/adapters/live2d.js`（路由），`scripts/plugin-*.js`，`test/gateway/deviceHub/**` | PLAN-android-ws3-device-hub.md |
| WS4 Android 原生壳 | Sonnet 5.5（medium） | `agent/ws4-android-native` | `apps/android/**`（`app/src/main/assets/web/` 与 `sample-plugins/` 除外） | PLAN-android-ws4-android-native.md |
| WS5 Android Web 前端 + 插件 SDK | Sonnet 5.5（medium） | `agent/ws5-android-web` | `apps/android/app/src/main/assets/web/**`，`apps/android/sample-plugins/**`，`scripts/android-sync-assets.js` | PLAN-android-ws5-web-ui.md |
| 统筹 | Claude（本会话） | `feature/android-companion` | 契约文档、合并、集成测试、真机验收 | 本文件 |

每个工作流在独立 git worktree 中开发（`../yachiyo-wt/<ws>`），只修改负责路径。共享文件（`apps/gateway/server.js`、`package.json`）的修改必须**局部、最小**（单独的装配函数 + 一两行挂载），以降低合并冲突。

## 4. 依赖与合并顺序

```mermaid
flowchart TD
  BASE[统筹：契约 + 接口桩 commit] --> WS2 & WS3 & WS4 & WS5 & WS1
  WS2 --> M1[合并 1：WS2]
  WS3 --> M2[合并 2：WS3]
  M1 --> M3[合并 3：WS1 pi（rebase 到 M2）]
  M2 --> M3
  WS4 --> M4[合并 4：WS4 + WS5]
  WS5 --> M4
  M3 --> INT[集成：真机端到端验收]
  M4 --> INT
```

- 统筹者先提交接口桩：`apps/runtime/config/modelCatalog.js`（v1 兼容的最小实现）与 `apps/gateway/deviceHub/index.js`（空实现），使 WS1 可以在 WS2/WS3 完成前按契约编码。
- WS4 与 WS5 并行：WS5 用 `js/mockNative.js` 在桌面浏览器 / 真机浏览器中开发调试，合并后由统筹者联调。

## 5. 验收标准（统筹者执行）

| 编号 | 验收项 | 方式 |
|---|---|---|
| A1 | `npm run test:ci` 全部通过（基线 507 + 新增） | 自动 |
| A2 | `./gradlew :app:testDebugUnitTest :app:assembleDebug` 通过 | 自动 |
| A3 | 小米 6 安装 APK，竖屏全身显示，背景可自定义 | 真机 |
| A4 | 手机连接电脑网关；电脑端 agent 的 live2d 工具驱动手机上的人物 | 真机 |
| A5 | 移交动画：电脑 ↔ 手机往返各一次，非 host 端不显示人物、不发声 | 真机 + 桌面 |
| A6 | 手机播放 TTS 并口型同步；按住说话 → 识别 → agent 回复 | 真机 |
| A7 | 横屏聚焦上半身；左滑插件入口、右滑组件区，动画连续无跳变 | 真机 |
| A8 | 导入示例插件（app + widget）；插件经事件总线与电脑端通信并注册工具，agent 能调用 | 真机 |
| A9 | 电脑端推送插件到手机并自动安装 | 真机 |
| A10 | 设为默认桌面；锁屏显示人物，锁屏下 agent 可控制人物/语音，插件不可用 | 真机 |
| A11 | DeepSeek 等 provider 配置、多模型选择、回退生效；电脑配置页/桌面聊天窗可切换，手机不暴露模型或 Provider 配置 | 自动 + 手工 |
| A12 | `AGENT_CORE=pi` 下全部原有 e2e 测试通过；`AGENT_CORE=legacy` 可回滚 | 自动 |
| A13 | 每个功能均有 `FEAT-*` 文档与 `TC-*` 用例，`docs/README.md` 索引更新 | 审查 |
| A14 | 配置页自动发现同一局域网服务端，选择端点并配对 | 真机 |
| A15 | 小米 6 连续人物动画及滑动达到 60 FPS 目标，报告真实帧间隔和画质 | 真机性能采样 |
| A16 | 手机使用已选官网宫殿夜景（通过系统选图导入私有目录，离线可用），Android 面板/设置与桌面聊天/控制浮层视觉统一；桌面可真实选择模型并拉取 Provider 模型列表 | 自动 + 真机/桌面截图 |

## 6. 统筹待办

- [x] **网关局域网加固**（WS3 合并后，统筹执行）：网关监听 `0.0.0.0`，`/api/config/*`、`/api/sessions*`、`/api/memory*` 等管理接口目前对局域网无鉴权，且既有 `GET /api/config/providers/config` 会返回内联 api_key。方案：非 loopback 请求必须携带 Device Hub `pairing_token`；`/api/config/providers/config` 与 `/raw` 对外脱敏。
- [x] **WS3 合并审查必查**：设备 `pub` 不得发布网关保留主题（`plugin.install`、`avatar.host.changed`、`avatar.transfer.*`（除 ready/exited/entered）、`sys.device.online/offline`、`voice.play`、`chat.delta/final`、`task.update`）。`/api/device/*` 保留精确 Android appassets CORS；模型与 ChatGPT 管理接口改为仅电脑 loopback 使用，不再向 Android 暴露。
- [x] **工具名线上编码（阻塞多 provider）**：`config/tools.yaml` 工具名含 `.`（如 `live2d.motion.play`），OpenAI/Anthropic/DeepSeek 要求 `^[a-zA-Z0-9_-]{1,64}$`。在 `apps/runtime/agent-pi/toolBridge.js` 中把名称编码为线上名（`.`→`__`），执行时映射回原名；`piRuntime.js` 中 `toolName.startsWith('live2d.')` 等判断与 eventBridge 发出的 `tool_call.*` 事件需使用原名；补测试。
- [x] WS1 遗留：`attachModelContext` 与 WS2 的 worker `model_ref` 透传重复，可删除。
- [x] 合并时统一重新生成 `package-lock.json`（WS1 合并时已 `npm i`）（WS1 新增 pi 依赖）。

## 7. 进度

| 工作流 | 状态 | 最新提交 | 备注 |
|---|---|---|---|
| 统筹：文档整理 + AGENT.md | done | 608edd7 | |
| 统筹：实验 + 契约 + 施工文档 + 接口桩 | done | 0c2b84b | |
| WS1 | merged | 7d4419a | 合并后 564 测试通过；待办：工具名线上编码 |
| WS2 | merged | 63504a1 | 统筹审查修复：/test 凭据外泄（63504a1）；538 测试通过 |
| WS3 | merged / integration | 84c2924 | 设备总线已合并，继续鉴权、发现广播和跨端联调 |
| WS4 | merged | c039c32 | 修复后合并：Bridge 令牌门控（391ab63）、插件推送仅信任网关且 token 不外发；Gradle 单测 + APK 构建通过 |
| WS5 | merged / integration | 0eaf75c | Web 前端已合并，继续自动发现配置与真机联调 |


## 8. Codex 接续验收（2026-10-12）

- 已保留旧 worktree 与未提交契约修改，新增三个独立 `agent/*` worktree；子 agent 统一 GPT-5.6 Sol / high，统筹负责合并验收。
- WS3 合并后 Node 588/588；WS5 合并后隔离测试环境 Node 624/624。首次 WS5 回归出现 legacy 子进程启动 7 秒超时，隔离后全量通过，继续观察。
- 集成 Android 已同步模型资源，JDK17 单测与 assembleDebug 通过。
- 用户新增目标 A14：配置页自动发现同一局域网的服务端、选择地址并配对；接口见 C7，广播不暴露令牌。
- 新分工：`ws1-pi-completion` 负责工具名兼容与 pi 补查；`ws3-integration` 负责网关通信边界、音频元数据与发现广播；`android-integration` 负责 Android 联调与发现 UI。
- 真机初验等待现有 WS5 设备锁释放，不抢占正在使用的设备。

### 集成批次 2

- 汇合 pi `74992fc`、Hub `2cb9de1/4e1c504/d553318/400969a/e976ec3`、Android `9fd91be/69d7e7e/e3e915e/4d99a7b`，同步依赖锁文件。
- 全量 Node 642/642 通过，Android 单测/assembleDebug 通过；新增完整 pi → Hub → 手机插件 RPC 离线 e2e 通过。
- 真机竖横屏、两侧面板、插件推送/安装和 start_timer RPC 已通过，详见集成实验与 TC-COMP。
- 新增用户目标 A15：小米 6 60 FPS。初始横屏仅20.34 FPS；耗时主要在 Cubism 求值，正在性能专项优化，不标记验收完成。

### 集成批次 3（2026-10-13）

- `c524618` 修复带在线 WebSocket 的网关退出及广播失败降级，Node 644/644。
- `38cbb2a` 修复 Android 模型响应包装造成设置渲染中断，以及锁屏覆盖页无法退出；Node 646/646、Android 单测和构建通过。
- 原真实模型配置复制到权限受限的隔离目录，pi 联网调用 Qwen 返回“模型连接正常”，约 1999 ms；未更改用户原运行目录。
- 真实 Electron 渲染器已显示移交人物；双向 transfer API 均成功。手机返回截图因休眠全黑，待唤醒后的视觉确认，不把 API 成功替代画面验收。
- NSD 已在小米 6 发现真实广播名称/IP/3002 端口；候选点击流程在设置修复后复验。
- 默认 Launcher 已实际切换并恢复；锁屏无插件、单次 RPC 路由、插件拒绝已验证，退出修复待复验。
- TTS/ASR 真实服务验证通过，手机播放、口型、录音仍需独立设备验收。
- 性能继续作为阻塞项：基线瓶颈为 Cubism core 与物理求值，Worker 优化版正在独占设备复测。

### 2026-10-13 后续修复与用户反馈

- `c96dc4b`：稳定基线音频HAL兼容修复；Node653/653、Android通过；真机TTS播放2407ms和口型变化通过。
- 用户反馈实验版人物抽动，已撤回手机上的性能实验APK；主线尚未包含Worker/physics节流/渲染器实验。手机保持稳定版（含音频修复）。
- A15仍未达标；后续性能候选必须同时通过动作连续性、口型、绘制次数和帧率验证。
- 真实API后续遇到阿里云Arrearage；不再重试或修改用户账单。麦克风采集已验证，完整实录ASR→回复仍未完成。
- 用户新增背景选择需求：为八千代寻找更贴合影片月读虚拟空间、适合人物叠加的背景。

- 隔离性能候选 `827f036` 真实 draw 达竖屏55.59FPS、横屏连续滑动54.27FPS，Worker18Hz左右并插值；目标仍未通过。测试后恢复含音频修复的稳定 APK，继续优化绘制状态调用。
- 背景已向用户展示官网水上宫殿夜景原图，尚未替换手机配置。

- 主线合入麦克风流隔离 `0da92cf` / 畸形帧保护 `f7b0dd7`，Node658/658通过。
- 用户购买通用节省计划后授权复测，最小模型请求HTTP200/1363ms、pi到手机TTS播放2325ms成功；空实录ASR仍待调查。
- FPS计时已发现host/CDP采样边界偏差，后续只用页面时钟。02cf3f6暖机真实draw55.96FPS，继续交错VBO优化；候选未合并，手机保持稳定版。

### UI 刷新工作流（2026-10-13）

- 统筹决策：采用官网 `character_bg.jpg` 宫殿夜景；素材不复制进仓库或默认发布包，真机通过现有系统选图 → `NativeFeatures` 私有目录导入，以保证离线持久化。设置页保留带来源链接的网络预设，加载失败时以 `#090b20` 回退色显示。
- Android `08f3198`：主舞台、HUD、横屏面板、抽屉和设置页统一深蓝紫夜景、暖金/淡紫强调色。侧面板使用内部静态高斯预模糊装饰层，不对 Live2D 使用大型 `backdrop-filter`，因此不新增每帧人物离屏滤镜；未修改 `stage.js`、Live2D core、渲染优化器或人物动作逻辑。
- Desktop：透明人物窗口保持透明；聊天、气泡、布局/口型/拖拽区浮层统一夜景视觉。聊天窗模型选择经 main process 精确 allowlist 调用现有 `GET /api/config/models`、`PUT /api/config/models/selection`、`POST /api/config/models/discover`；请求体按操作投影，成功响应再次投影掉 `headers`、`extra_body`、`base_url`、`api_key_env` 等配置字段，错误和网络异常统一脱敏，renderer 不接收 token/API key。
- 自动验证：候选分支 Node `npm run test:ci` 664/664；独立审查修复后隔离 `HOME`/`TMPDIR` 全量 Node 665/665。Android JDK17 `:app:testDebugUnitTest :app:assembleDebug` 通过。
- 尚待验收：手机因电量耗尽关机，重启后由性能验收工作流安装 `1169fd3` 构建的最终 UI APK，确认设置页职责边界、背景持久化并恢复临时旋转设置。Desktop 启动、模型保存重开及成功/空/离线状态已完成。
- 真机已通过系统 DocumentsUI 把官网 2400×1440 夜景复制到应用私有 `files/user/backgrounds/`；强停重启后背景保持。竖屏人物、横屏插件抽屉与设置页截图已留存；背景素材未进入发布包。
- 用户明确手机是客户端：Android 已移除模型目录拉取、模型选择、Provider 与 Provider API key UI/调用。桌面继续提供模型选择和 Provider 列表拉取；ChatGPT 登录与模型资料也只在电脑端。
- 本轮原候选提交顺序为 Android `08f3198`、Desktop `2958a90`、手机客户端职责调整 `1169fd3`、Desktop 首启竞态修复 `05eebd3`、验收记录 `7e99c43`；独立审查分支对应提交为 `74aae6e`、`03c1828`、`4c2401e`、`6150bf6`、`d367287`。审查发现并以 `8ad8b31` 修复 Desktop 模型 IPC 成功响应可暴露 Provider headers/extra_body 等字段的问题；音频证据与实时 TTS checkpoint `251b1b2` 对应集成提交为 `f344cc2`。
- 性能候选 `48a574b` 在关机前采到 idle 54.12 FPS、swipe 52.18 FPS，A15 未达标。该样本临近用户确认的电量耗尽，只能说明本次验收未达到 60 FPS，不能单独用于判定交错 VBO 优化发生性能回退；人物抽动仍需最终融合包独立复验。
- Desktop Electron 已连接隔离网关 `127.0.0.1:3002` 实测：首次打开直接加载 2 个模型/4 个 Provider；对当前模型执行保存后刷新 renderer，仍恢复同一 active ref。模型浮层截图为 `/tmp/ui-refresh-desktop-chat-models.png`。状态化本地网关自动覆盖 discover 成功、空列表、服务离线与保存后重开。实测同时发现并修复了 chat renderer 早于模型 IPC 注册的首次启动竞态。

### UI 独立审查与主线集成（2026-10-13）

- 代码与截图审查通过：Android 无模型、Provider 或 API key 入口；官网背景保留来源链接，系统选图会复制到 App 私有目录并由配置保存；横屏侧面板只模糊自己的静态伪元素，不对 Live2D 每帧做大面积 `backdrop-filter`；Desktop 首启 IPC 注册顺序、成功/空/离线及保存重开路径均有证据。
- Desktop IPC 原候选只限制 method/path，但网关成功快照仍含 Provider `headers`、`extra_body`、`base_url`、`api_key_env`。审查修复后，选择请求仅允许 `active_model`/`enabled_models`，发现请求仅允许 Provider key；返回只保留模型展示字段和 Provider key/display name/凭据存在性布尔值。
- UI 与音频文档批次已通过独立工作树验证，允许合入 `feature/android-companion`；最终手机安装、背景重启持久化和竖横屏观感仍由设备验收工作流通过 USB 执行，不能用历史截图替代本轮验收。
- A15 仍未通过：最终 UI 包此前采样未达到 60 FPS，人物抽动也没有验收通过。用户最新报告空闲时人物持续张嘴且嘴形异常；最终 UI 包已复现静音后 `mouth form` 残留，此问题由独立口型修复工作流处理，未把任何 Worker/VBO/physics 候选并入本批次。
- ChatGPT 认证/模型资料工作仍在独立计划分支，尚未审查合并。实时 TTS 仅完成设计 checkpoint；物理扬声器在系统音量 17/25、应用音量 1 下由用户确认正常，真实讲话 ASR→pi 回复仍未完成。

### 静音口型修复与桌面恢复（2026-10-13）

- 独立审查后把口型修复 `ecdfb6b` 映射为主线 `59a805d`，验收文档 `57d6cd4` 映射为 `000c504`。修复在 Cubism 的真实 `beforeModelUpdate` 中持续恢复 MOC 口型默认值，同时保留 action/RPC overlay 与活跃语音的更高优先级；release 同帧把 stage 的 open/form/active 归零。
- 小米 6 USB 真机子集通过：静音 Idle 15 秒 466 次真实更新全为 0/0；本地参考音频播放中口型自然变化；结束后 3 秒 94 次真实更新全为 0/0。Greet/ReactError 和显式 overlay 尚未单独真机操作，由资源审计与自动化覆盖。合并后隔离 Node 667/667、Android JDK17 单测与 Debug APK 构建均通过。
- 用户反馈电脑端不可见时，隔离 gateway `127.0.0.1:3002` 与 Electron 均在运行，实际原因是 `avatar_host` 仍为 Android。手机验收释放设备后，正常 `avatar.transfer` 已切回 `desktop`；CUA 分别确认角色窗口和聊天主界面实际可见。主界面常驻双向迁移按钮由独立 UI 工作流实现，复用现有 transfer/owner/pending 状态。
- A15 仍未通过，身体抽动也未验收通过。本轮口型结论不能替代 60 FPS、连续身体动画或性能候选验收；设备当时温度 46°C、电量 27%，不用于性能基准。
- ChatGPT 认证候选的独立审查发现 ID token 经 authorization URL 泄漏、loopback 写 API CSRF/DNS rebinding、并发 start listener 泄漏和 OIDC `azp` 缺失；修复候选仍在复审，未合入主线。实时 TTS 与真实讲话 ASR→pi 回复仍在进行。

### 用户停止 checkpoint（2026-10-13）

- 用户要求立即停止开发并保留完整交接；主线停在 `d2d606b`，没有继续合入 Android presence、Desktop native shell、配置 WebUI 或 ChatGPT OAuth 候选。
- 手机“角色突然出现后消失”的根因已定位为 Android 旧 `isHost()` 在 Device Hub 断线/owner 未知时默认返回 true，重连收到权威 `avatar_host=desktop` 后再隐藏。独立修复 `d3d526a` 已保存且聚焦测试 3/3 通过，但未合主、未构建 Android、未装机；完整 Desktop/Android 迁移控件仅以未审查 WIP `5d59805` 保存。
- 配置 WebUI 重构仅完成只读盘点与方案文档 `5db6a91`，产品代码未开始。当前 `/api/config/models` 仍会返回 Provider `headers`/`extra_body`，且整个 `/api/config/**` 尚未实施真实 socket loopback-only 门禁；恢复工作时先修安全边界。
- ChatGPT OAuth/Responses 候选链 `111c933` → `5b8f67f` → `f99f2d2` → `95260ee` 已完成代码与修复候选审查，但未合主、未做真实 OAuth/API；恢复时必须在当前主线重放并处理文档/配置 UI 冲突后再跑隔离全量测试。
- 详细分支、测试、运行态、设备状态和下一步见 [HANDOFF-20261013-companion.md](../process/HANDOFF-20261013-companion.md)。A15 仍为 55.96 FPS、未到 60；身体抽动未通过。共享 mask 局部 dirty 候选 `7ff5774` 因会清空共享 FBO 后漏画未变化 source，已由 `bb4a197` 撤销，未安装、未合主。

### 请求级模型选择与 Omni 音频（2026-10-13）

- 用户最新要求覆盖「手机不显示模型」的旧决定：Provider、API Key、启用列表和默认模型仍只在电脑配置页管理；手机只读取电脑端已启用模型的安全目录，并可为当前文字或语音请求选择模型。
- Desktop Chat 与 Android Chat 均把 `model_ref` 随本次输入发送，不再因聊天切换而修改全局 `active_model`。手机目录通过 Device Hub RPC `model.catalog.get` 提供，明确排除 URL、环境变量名、headers、extra_body 与凭据。
- Qwen 预设新增 `qwen3.8-omni-flash`（整段 WAV 音频直通）和 `qwen3.8-omni-flash-realtime`（16 kHz PCM 输入、24 kHz PCM 输出）。两种音频输入均进入当前长生命周期 Pi `AgentSession`；Realtime adapter 把 function call 交给 Pi 工具桥，并把原生文字与音频作为独立 side channel 返回手机。
- 模型配置 schema 新增能力校验，拒绝未知 input/output/transport、缺失 audio 输入以及 Realtime mode/transport 不匹配。自动化覆盖 TC-LLM-040 ~ 042、TC-VOC-024/025、TC-AND-053、TC-DESKTOP-005。
- 启动新网关读取既有验收配置时发现，历史「发现模型」条目会把已知 Omni 型号保留为 text/request；新增规范化迁移，以内置型号资料恢复其权威音频能力，覆盖 TC-LLM-043。
- 运行态验收：停止旧主线网关后从 `agent/v2-config-webui` 在 3002 启动新网关；健康检查、配置页六列编辑器和真实 Device Hub `model.catalog.get` 通过。小米 6 经 Wi-Fi ADB 安装 Debug APK，WebView 显示 10 个已启用模型，Realtime/Direct Omni 分别标注“实时语音/音频直通”；切换 Realtime 后状态徽标变为“实时”，随后恢复默认模型并释放设备锁。未向模型上游发送请求。
- Realtime 录音失败根因确认：现有 `qwen3.8-omni-flash-realtime` 继承公共 `dashscope.aliyuncs.com` 地址，但该型号要求工作空间专属 `wss://*.maas.aliyuncs.com`，当前配置中没有可推导的 Workspace ID。网关现保留 `-32602` 具体错误，电脑配置页拒绝保存无效组合，两端选择器显示并禁用不可用模型。Node 804/804、Android 单测与 Debug 构建通过；小米 6 重装后通过 WebView CDP 验证 Realtime 项显示“不可用”，当前自动回退到可用的 `qwen3.8-omni-flash` 直通模式。
- 本机阿里云 CLI 的 Model Studio 扩展已查询北京地域默认工作空间与目标模型推理权限；工作空间专属 Realtime 地址已写入隔离验收配置和 `~/yachiyo/config/providers.yaml`，原配置备份为 `providers.yaml.before-omni-realtime`，全程未记录密钥。真实云端文本握手、16 kHz PCM 输入、转写、文字回复与 24 kHz PCM 输出均通过。
- 小米 6 实际长按录音完成手机麦克风 → 网关 → Qwen Realtime → 手机流式播放。测试音源受环境低频声干扰而得到英文机械声描述，结论为链路通过、声学内容识别待真人近讲复验。Realtime 原生音色原先硬编码为 `Tina`，已改成统一默认 `Cherry` 并允许模型级覆盖。
- Pi 语音策略提高音频输入、短对话、问候与确认的语音优先级；需要语音时 TTS 是本轮首个动作。真实 `/ws` 策略模式调用顺序已验证为 `voice.tts_aliyun_vc` → `live2d.expression.set`，并修复缺失 `voice-policy.yaml` 时自动语音被静默关闭的问题。
- Realtime 已取代临时“转写后再进入 Pi”的双模型链路：原始音频挂入 Pi user turn，Qwen Realtime 只作为 Pi model adapter；Function Calling 经 Pi 工具桥执行并复用同一个会话的人格、Skills、历史、权限和工作区。正常 Realtime 原生语音不激活独立 TTS，工具事件、界面文本和原生音频分别输出。
- 使用 18 秒标准参考音频为 `qwen3.8-omni-flash-realtime` 创建 Yachiyo 复刻音色，并写入隔离与用户 Provider 配置。真实云端请求成功调用 `system.get_time`，工具结果续答为中文，收到 311040 bytes 24 kHz PCM；随后重启网关与手机 App，真机显示角色、Realtime 徽标及“电脑在线”。设备锁和临时 ADB forward 已释放。
- 修复手机聊天框重复/交错：旧画布全局只保存一个 assistant 流，多个 Realtime trace 重叠或相同 final 重送时会互相终止并重复建卡。现按 `trace_id` 独立维护流式气泡，对完成 trace 做有界幂等记录；同时移除 Realtime 桌面文字路径与网关会话钩子的重复持久化。TC-AWB-041、Node 811/811、Android 单测与 Debug 构建通过；小米 6 注入交错 trace 和重复 final 后 DOM/截图仅保留“甲一”“乙二”两张气泡。
- 修复手机聊天气泡不会自动消失：原实现复用单个全局淡出计时器，新回答的首个增量会取消上一条回答的计时且不再恢复。现将计时器绑定到每张气泡，新旧 trace 的展示周期互不干扰；新增 TC-AWB-042 覆盖“旧回答等待淡出时开始新回答”的回归场景。

- 根据小米 6 横屏截图重做对话几何：居中双列改为脸部保护线以下各占半屏，取消 420 px 上限，允许覆盖人物下半身以提高长文可读性。未收到 `chat.final` 的中断流在最后增量 30 s 后自动淡出，新增 TC-AWB-043。
- 实际日志定位手机“说话后不回应”：上一条 Apple Music 语音任务连续重试工具并进入第 8 轮模型决策，单 worker 一直被占用。现同 session 新语音会 abort 旧 Pi turn，音频 turn 90 s 硬超时；Realtime 模式下新录音也会取消仍在工具回合的旧连接。新增 TC-PI-029、TC-VOC-029。
- 手机任务卡把同一任务内名称与状态相同的重复步骤合并计数，连续工具重试显示为 `shell.exec ×N`，避免一次失败链刷出多行相同错误；新增 TC-AWB-044。
- 定位 Realtime “不记得刚做过的事”：本机会话已有 91 条消息，但每轮新 WebSocket 仅把最近 10 条拼入 instructions，模型在实际追问中否认了前序操作。现将最近 20 条按 user=`input_text`、assistant=`output_text` 恢复为原生 conversation items，并在当前输入前发送；更早历史刷新为 session memory 摘要/相关片段。新增 TC-VOC-030。
- 手机迁移失败排障确认 Android 生命周期竞态：小米 6 的 Main 已前台，但 LockscreenActivity 在独立任务中仅 paused 未销毁，共享 Hub 仍保持 `lockscreen`，导致 Main 丢弃 `avatar.host.changed`，页面错误显示“当前在手机”。修复为前台 Web 宿主在 `onResume` 重申 mode 并重放权威 Hub 快照，同时销毁 Bridge 时停用 dispatcher。真机保留 paused Lockscreen 后 mode 恢复 normal；手机显示与网关 owner 一致；电脑→手机→电脑往返均 HTTP 200；设置页销毁后未再出现 destroyed WebView，覆盖 TC-AND-054。
- 最新运行错误定位为同一 `device-<id>` 会话在 `shell.exec` 仍执行时收到第二段 Realtime 语音：外层误判会话空闲并再次调用 Pi `prompt()`，触发 `Agent is already processing a prompt`。现已统一 active-run 判断；手机新语音通过 Pi 原生 abort/AbortSignal 立即取消旧 run、审批等待和可取消工具，旧请求收口后再进入同一长期 AgentSession；shell 子进程支持信号终止，普通 steer/followUp 语义保持。TC-PI-043 与全量 Node 854/854 通过。重启 3002 网关后用真实 Qwen3.5 Flash 验收：旧轮进入 `bash sleep 20` 后被新音频请求在 1.95 s 处以 `SUPERSEDED_BY_VOICE`/`ABORTED` 收口，新轮 1.51 s 返回“打断成功”，未再出现重复 `prompt()`；小米 6 Wi-Fi ADB 确认主界面在线、角色与 Realtime 选择器正常，设备锁已释放。
- 工具能力审计确认 Pi 1.1.0 原生提供 `read/bash/edit/write/grep/find/ls`（Windows 另有 PowerShell），而当前桥接遗漏 `grep/find/ls`，并把 `shell.exec`/`workspace.write_file` 与原生入口重复暴露。现接入三个专用只读工具并保持并行与会话路径边界；重复 adapter 仅保留为策略后端。真实日志中 Python 命令因 `cd &&` 进入策略审批并等待 74 秒，说明 bash 后端仍需后续改善流式输出与审批提示。TC-PI-037 与全量 Node 855/855 通过；重启 3002 网关后用真实 Qwen3.5 Flash 要求列目录，模型直接调用 `ls`，工具结果约 2.50 s、整轮约 4.12 s，未绕回 `shell.exec`。
- 用户进一步明确 Yachiyo 本质是前端：标准命令审批、危险命令和工作区边界迁入 AgentSession 内的 Pi extension；`read/bash/edit/write/grep/find/ls` 改用 Pi 原生本地执行，Yachiyo 的 `ApprovalCoordinator` 只把 Pi 等待的决定投影到桌面/手机。原 `shell.exec`、`workspace.write_file` 不再是 Pi 后端，仅保留 legacy 兼容。
- Pi 工具策略真实链路已在 3002 网关使用 Qwen3.5 Flash 验收：`full_access` 下原生 Bash 输出当前 `PI_SESSION_ID` 且不请求批准；`manual` 下收到 `approval.requested`，经现有 HTTP 前端接口批准后同一个 tool call 继续并输出预期结果；`full_access` 下 `sudo whoami` 仍由 Pi extension 在执行前拒绝；`auto_approve` 下原生 `write` 尝试写 `/tmp` 被工作区策略拒绝，目标文件不存在。Node 全量 861/861 通过。Pi 文件工具边界为直接参数校验；Bash 仍继承宿主权限，若后续要求内核级不可绕过隔离，需引入 Pi 沙箱/容器执行后端。
- 消息框已注册为所有 Pi 模型可用的 `ui.chat.post` 工具：Android 与 Desktop Chat 消费同一完整消息事件，原生 Realtime 音频、文字和工具状态互相独立；显式消息后的内部确认隐藏，未调用工具时 final 仍恰好显示一次。Qwen Realtime 的消息工具续轮固定 text-only，避免第二套语音。Desktop Chat 新增麦克风按钮，录音转 16 kHz PCM WAV 并携带当前 `model_ref` 进入与手机相同的 Pi 音频入口。
- 修复最后一条完整消息看似永久驻留：`ui.chat.post` / final-only 气泡不依赖先收到 delta，长回答的展示上限由 60 秒收紧为 24 秒，之后执行 420 ms 淡出并在无其他内容时隐藏画布，覆盖 TC-AWB-050。
- 提交 `656f9a1` 后完成真实联调：Node 869/869、Android 单测与 Debug APK 构建通过；小米 6 经 Wi-Fi ADB 安装，真实 Qwen3.5 Flash 调用 `ui.chat.post` 后只显示一张气泡，内部 final 标记 `ui_hidden=true`，25 秒截图确认最后气泡已消失。Electron 使用同一 3002 网关时，Desktop Chat 可见当前模型、麦克风按钮和“送到 mi6”，完成手机→电脑→手机迁移往返后释放设备锁。麦克风按钮未采集用户声音，避免在无人确认时把实际环境音频发送到模型。
- `agent/pi-runtime-v2` 的 37 个提交已快进合并到 `feature/android-companion`，临时 worktree 与分支已删除；原主工作区未提交的 Qwen 3.7/3.6/3.5 预设更新在合并冲突中保留，并与 Qwen 3.8 Omni 条目合并，专项用例改为检查型号集合而非写死目录数量，覆盖 TC-LLM-045。
- Worktree 收口审计用 `git cherry` 区分未交付提交与补丁等价副本；清理 11 个已合并或补丁等价且工作树干净的旧 checkout。仍保留的 9 个 worktree 均含主分支尚无的独立提交，或存在未提交改动，避免为追求目录整洁而丢失工作。
- 真实 Qwen3.8 Omni Realtime 日志确认两种新故障：模型对“查看电脑网卡”只返回行动承诺，没有产生 function call；随后较长录音把整段 Base64 PCM 放进单个 conversation item，触发上游 `1009 Max frame length of 262144`。主线新增一次 Pi 内部行动纠偏续轮，并按官方 Realtime Manual 协议改为 `input_audio_buffer.append ×N → commit → response.create`，自动化覆盖 TC-PI-046/047。
- 修复提交 `04d7fb4` 后 Node 873/873、docs lint 通过。真实 Qwen3.8 Omni Realtime 在隔离 full_access 会话调用 Pi 原生 `bash` 查询主机名，4.37 秒完成；复放原先触发 1009 的 212844 bytes 手机录音后，7.68 秒完成 `bash → ui.chat.post → live2d.emote`，没有连接断开或工具解析错误。3002 网关已重启到该提交，手机和 Desktop 均重新上线，Avatar owner 保持手机，设备锁为空闲。
- 手机随后出现“我这就帮您看看桌面上的文件”后无动作。对应 trace 正常 `DONE`，但没有任何 tool call；原因是空承诺纠偏器覆盖“查看”却漏掉口语叠词“看看”。现扩展中文承诺识别到“看看/查一下/找一下”等变体，并以真实日志原句补入 TC-PI-046；普通“我可以帮您看看”能力说明和已调用工具的回合仍不会误触发。Node 全量 874/874 与 docs lint 通过；3002 网关已重启，Desktop 与 mi6 均重连，Avatar owner 保持手机。
- 真机复现横屏对话不可见：小米 6 的 640×360 dp 上半身聚焦把完整模型放大到约 628 dp 高，固定 30% 保护比例将对话上边界推到胸口，旧双列仅剩约 47 dp，低于 72 dp 阈值后被隐藏；双列到合并视图的过渡还可能暂时把回答列压到 0 高。横屏中心态改为统一宽屏时间顺序面板，upper 保护比例改为 20%；左右滑时同一面板连续收窄并移动到侧栏外，全身取景继续使用 30%，覆盖 TC-AWB-039/051。Node 876/876、Android 单测与 Debug 构建、docs lint 通过；同步共享主题资源后重装小米 6，CDP 实测中心态 612×118 dp、左右半程约 467×95 dp，全程 `visibility=visible`，截图确认面板位于脸部下方。系统旋转与 ADB 转发已恢复，设备锁已释放。

### 跨端会话与历史界面（2026-10-13）

- Device Hub 新增 `session.list/history/create/select` RPC，并把设备当前选择绑定到对应的长期 Pi `AgentSession`。文字、录音、Realtime、审批和工具执行继续使用同一会话；迟到事件按 `session_id` 隔离，历史接口只返回 user/assistant 可见消息。
- Android 新增两段式历史面板：第一次下拉显示预览，再次下拉铺满整屏；全屏与预览支持对称上滑逐级收回，预览态点击卡片外空白遮罩可直接关闭。入口手势覆盖屏幕上方约 22%，聊天气泡、历史滚动、输入框和工具卡保持各自滚动，不会误触。
- 竖屏会话项压缩为单行横向列表，横屏会话项改为左侧纵向列表，右侧保留消息阅读区；面板打开时旋转设备会先淡出并位移，再按新方向重排淡入。历史支持安全 Markdown，并可在面板底部直接向当前会话发送消息。
- Desktop Chat 新增长期会话侧栏与新建/切换能力。两端把工具执行状态从聊天文本中分离：Android 右上角、Desktop Chat 右上角独立显示活动卡片；完成或失败约 8 秒后收起。完整聊天气泡统一约 10 秒后收起，横屏长文在脸部保护线下动态扩展。
- Pi 提示词明确以用户交互为最高优先级：长任务先回应，适合语音时先发送语音，同时通过独立消息链路说明正在做什么和最终结果；工具状态不会冒充聊天回复。
- 自动验证：`npm run test:ci` 885/885，`npm run docs:lint` 通过，Android `:app:testDebugUnitTest :app:assembleDebug` 成功。小米 6 经 Wi-Fi ADB 验证两段展开、全屏无底缝、宽松上滑收回、预览外部点击关闭、Markdown、会话内发送、横屏左侧会话栏、旋转后重排、独立工具卡和 10 秒气泡消失；临时旋转设置与设备锁均已恢复。
- 关联文档：`docs/features/FEAT-runtime-chat-sessions.md`、`docs/features/FEAT-android-live2d-stage.md`、`docs/features/FEAT-desktop-shell-and-chat.md`；用例 TC-HUB-033/034、TC-AWB-052～056、TC-DSK-029、TC-PI-048。
- 交付提交：`b65d676`（跨端长期会话、Android 历史面板、Desktop 会话侧栏、独立工具状态与交互反馈策略）。
- 用户追加要求把历史面板改为连续跟手抽屉：顶部下拉与底部上推都实时驱动面板底边，视口中线作为 `closed ↔ peek ↔ full` 的统一吸附阈值；预览外部点击关闭与滚动区域手势隔离继续保留。首版因输入区整体拦截手势，遗漏了全屏时从物理屏幕最底边起手；修正后在输入框下方加入全宽抓取区。小米 6 实测下拉在中线前释放吸附半屏、越过中线吸附全屏；全屏从最底边上推在中线后释放回半屏、越过中线则完全关闭，慢速拖拽期间面板高度连续变化。该调整在 `b65d676` 的稳定检查点上独立提交。
