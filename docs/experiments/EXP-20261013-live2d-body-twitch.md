# Live2D 身体偶发抽动逐帧实验

> 类型: experiment
> 状态: done
> 负责人: Codex（工作流 T）
> 更新: 2026-10-13
> 关联: docs/features/FEAT-android-live2d-stage.md, docs/testing/TC-android-web.md, apps/android/app/src/main/assets/web/js/stage.js, apps/desktop-live2d/renderer/live2dParameterOverlay.js, scripts/dev/live2d-trace-capture.js

## 背景与假设

小米 6 上 Live2D 人物偶发身体/角度抽动。本实验只排查连续性，不恢复已放弃的 60 FPS 目标，也不引入历史 Worker、VBO、physics 或 mask 性能实验。

逐项验证的假设：Idle 循环边界无淡入重启；普通动作被同优先级打断；overlay 突然释放；在 `beforeModelUpdate` 之外直接写参数；跳帧累计 dt 尖峰进入 physics；同一参数存在多个业务写者；口型中性化误写身体参数。

## 实验环境（设备、版本）

- 设备：小米 6（Wi-Fi ADB `192.168.20.183:5555`），debug WebView。
- 代码基线：`fdd5085` WIP 加主线 `feature/android-companion`；修复分支 `agent/v2-twitch`。
- 模型：`assets/live2d/yachiyo-kaguya/`，Idle 10.0 秒循环、Greet 2.9 秒循环、ReactError 4.03 秒循环；model3 中淡入/淡出分别为 Idle 0.5/0.5 秒、Greet 0.4/0.4 秒、ReactError 0.3/0.3 秒。
- 采集：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` 后，以 CDP 调用 `window.__yachiyoStage.startTrace()` / `stopTrace()`；原始证据保存在本机 `/tmp/yachiyo-live2d-t/`，不提交生成数据。
- 用户正在运行的 `127.0.0.1:3002` 网关及配置未修改；未调用真实模型/API，未触发 avatar 迁移。

## 方法

1. 修复前采集 Idle 60 秒与 Greet、happy、sad、ReactError、nod、thinking 动作序列。
2. 每次真实 `beforeModelUpdate` 记录时间戳、raw dt、跳过帧累计值、模型/physics 实际 dt、motion 状态、overlay 数量，以及 `ParamAngle*`、`ParamBody*`、`ParamBreath` 等最终值。
3. 补强调试器：增加自动 motion 状态变化、表达式/focus、RPC 与 action 参数来源、motion 前后值、中央 physics 输入输出参数；调试开关默认关闭。
4. 对照 SDK 更新顺序：motion → expression → focus/breath → physics → `beforeModelUpdate` overlay → core model。审计所有应用代码中的参数写入位置。
5. 采用最小修复：Android 在 cached-model 帧期间冻结模型时间，恢复时只送当前页面帧 dt（最大 50 ms），不再 catch-up；Desktop 的非面部 RPC 改为 `beforeModelUpdate` 单写者 overlay，并在回 Idle 时缓释。
6. 用同一脚本复测并运行 TC-AWB-029..031。

## 数据与观察

### 修复前真机数据

| 场景 | 帧数 / 时长 | dt p50 / p95 / max | 角度/身体参数最大帧差（节选） |
|---|---:|---:|---|
| Idle | 1609 / 60.25 s | 33.2 / 50.0 / 50.0 ms | AngleX 1.0616；AngleY 1.5355；AngleZ 1.4567；BodyX 0.5613；BodyZ 0.5112；Breath 0.0242 |
| 动作序列 | 1023 / 38.50 s | 33.2 / 50.0 / **116.3 ms** | AngleY 5.9993（Greet）；BodyX 0.6101；BodyY 0.6229；BodyZ 0.8733；Breath 0.0242 |

- Idle 全程为 `Idle:0:1`；10/20/30/40/50/60 秒附近均无动作请求或 motion 状态硬切。SDK 在每个 10 秒循环末尾短暂完成并预约下一次 Idle，但模型资源已有 0.5 秒淡入/淡出，不是无淡入重启。
- 动作队列会在 duration 结束后请求 Idle；Greet/ReactError 的大 `ParamAngleY` 帧差来自动作曲线本身，并非随机 Idle 抽动。
- 动作样本末段出现 9 个 66–116 ms 更新。代码确认 `stage.wrapUpdate()` 把所有 cached-model 帧的 dt 累加到下一次 `internalModel.update()`，而 Cubism 会将该 dt（秒）原样传给 physics。页面普通 raw dt 已限制为 50 ms，因此超限只来自此累计。
- Android RPC/action 参数始终进入 `beforeModelUpdate` overlay，`releaseParams()` 将 goal 置 0 后按权重缓释；口型中性层只写 `ParamMouthOpenY` 与 `ParamMouthForm`，没有误触 `ParamAngle*`/`ParamBody*`。
- Desktop 的非面部 `model.param.set` 原先直接调用 `coreModel.setParameterValueById`，发生在 RPC 时刻；下一模型帧又由 motion/physics 重写，是已确认的帧间多写者。Desktop 没有 Android 的 skipped-dt 累计链路，因此不做无证据的 dt 修改。

### 修复后真机数据

一次 60 秒候选样本在 27–30 秒发生外部触控/focus（AngleX 被拉向 +30 后反向，并伴随手势跳帧），因此按实验纪律剔除，不拿它冒充空闲结果。最终采集在开始时临时调用手机端 `hubDisconnect`，结束后在 `finally` 中 `hubConnect` 恢复；这只隔离传入动作/TTS，不修改用户网关或手机持久配置。

| 场景 | 帧数 / 时长 | physics dt p50 / p95 / max | 角度/身体参数最大帧差（节选） |
|---|---:|---:|---|
| Idle（离线、无 focus/外部动作） | 1395 / 60.13 s | 33.2 / 50.0 / **50.0 ms** | AngleX 1.0596；AngleY 1.5635；AngleZ 1.4929；BodyX 0.6352；BodyZ 0.5774；Breath 0.0243 |
| 本地动作序列（离线） | 1051 / 38.20 s | 33.2 / 50.0 / **50.0 ms** | AngleX 1.2973；AngleY 5.4171；AngleZ 2.1691；BodyX 0.7230；BodyY 0.6027；BodyZ 1.3801；Breath 0.0243 |

修复前后最大帧差并非每项都单调下降，因为 Greet/ReactError 与 Idle physics 本身包含非固定相位曲线；完整报告仍原样列出，避免只挑有利指标。真正被修复的不变量是 physics 单步：交互 catch-up 从 116.3 ms 降为不超过当前 raw dt（上限 50 ms）。Idle 前后最大帧差同量级；动作样本 AngleY 从 5.9993 降至 5.4171，BodyY 从 0.6229 降至 0.6027，而 AngleZ/BodyX/BodyZ 随采样相位分别为 2.1691/0.7230/1.3801，不据此宣称动作幅度整体下降。

最终 APK 另在真机同步执行两个 50 ms cached-model 帧再恢复一个 33 ms 完整帧：trace 记录 `raw=33, skipped=100, dt=33, physicsDt=33, clamped=true`。也就是说旧实现会送入的 133 ms 累计步长被明确丢弃，最终实现不是仅把累计值截到 50 ms。

离线 Idle 中观测到 6 个 SDK 循环完成/重约 Idle 的边界；边界邻域最大帧差为 AngleX 0.3516、AngleY 0.3568、AngleZ 0.2845、BodyX 0.0531、BodyY 0、BodyZ 0.0534，显著低于全段自然峰值，排除“Idle 无淡入硬重启”为主因。

## 结论与决策

根因链成立：交互动画为了复用缓存网格而跳过模型更新，恢复时把累计时间作为一个大步长同时推进 focus、自然运动与 physics，导致身体从上一个可见姿态跳到较远姿态。修复保留现有渲染策略，但 cached-model 帧明确冻结模型时间，恢复时只推进当前页面帧 dt（仍受既有 50 ms 上限约束）；这是一项连续性约束，不是性能优化。

同时消除 Desktop 非面部参数的第二写者：RPC 只更新 overlay 目标，唯一 coreModel 写入发生在 `beforeModelUpdate`，回 Idle 后按权重渐退。表情/口型继续使用既有 face blend 单写者，不扩大修改范围。

不采用：修改动作资源、强行重启 Idle、全局关闭 physics、Worker/VBO/mask 路线、追求 60 FPS。这些方案要么与证据不符，要么属于已放弃/已知不安全的性能实验。

## 后续动作

- 保留默认关闭的 trace 与分析脚本，后续若再现可先检查 `focus` 事件、`clamped` 帧及 motion/overlay 时间邻近关系。
- 统筹合并后在最终 UI APK 上再做一次不少于 60 秒的观察；若有肉眼异常，保留当段 trace 而不是只录低频截图。
- 不把 trace 模式下的帧率用于性能验收。
