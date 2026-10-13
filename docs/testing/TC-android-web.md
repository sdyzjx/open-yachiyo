# Android Web 前端测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-ws5, Codex（工作流 T）
> 更新: 2026-10-13
> 关联: docs/features/FEAT-android-live2d-stage.md, docs/features/FEAT-android-gesture-layout.md, docs/features/FEAT-android-settings.md, docs/features/FEAT-android-session-approval.md, test/android-web/

手工设备用例的通用准备：`npm run android:sync-assets -- --serve`（Mac 上 `:8790`，手机经局域网访问 `http://<mac-ip>:8790/web/index.html?debug=1`，或用 `adb reverse`）；真机在 org.lineageos.jelly 或 App 内 WebView 中执行，调试用 `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`。

## TC-AWB-001 资源同步脚本参数与目录映射

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 解析 CLI 参数；解析 `/sdk/`、`/web/`、`/generated/` 请求路径 |
| 期望结果 | 参数默认值正确；路径映射符合契约 C6；共享模块源文件均存在 |
| 自动化 | `test/android-web/syncAssets.test.js` |

## TC-AWB-002 资源同步产物

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 联网（首次下载 Cubism Core），macOS 或有 ImageMagick |
| 步骤 | `npm run android:sync-assets` |
| 期望结果 | `generated/model/4096` 纹理为 4096²，`model/2048` 为 2048²；`manifest.json`、`config/live2d-presets.json` 存在；`git status` 不出现 generated |
| 自动化 | manual |

## TC-AWB-003 弹簧、吸附、手势轴锁定、橡皮筋

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 弹簧收敛/继承速度；短拖回弹、长拖/快甩提交、不能跨过中间态；轴锁定与测速；抽屉吸附 |
| 期望结果 | 全部断言通过 |
| 自动化 | `test/android-web/layout.test.js` |

## TC-AWB-004 相机取景计算

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 竖屏 full 与横屏 upper（上 55%、底边出血）取景；画质/聚焦解析 |
| 期望结果 | 缩放/位置符合公式 |
| 自动化 | `test/android-web/layout.test.js`（portrait full-body / landscape upper-body / quality） |

## TC-AWB-005 移交动画时间线

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | cubic-bezier 端点/单调；exit 下蹲 2%/120 ms + 滑出 480 ms；enter 520 ms 带回弹 |
| 期望结果 | 偏移曲线符合契约 C1.5 |
| 自动化 | `test/android-web/transfer.test.js` |

## TC-AWB-006 Hub topic 通配匹配与覆盖

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | `*`/`**` 匹配；patternCovers |
| 期望结果 | 符合 C1.2 语义 |
| 自动化 | `test/android-web/topics.test.js` |

## TC-AWB-007 原生桥接 shim

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 模拟 `__YachiyoBridge`：token 只握手一次并保存在闭包、参数序列化为 JSON 数组、二次握手被忽略并记录、无原生时不定义 |
| 期望结果 | 全部断言通过 |
| 自动化 | `test/android-web/nativeShim.test.js` |

## TC-AWB-008 竖屏全身显示与背景

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | App/浏览器竖屏 |
| 步骤 | 打开主页；设置里改背景颜色/选图 |
| 期望结果 | 人物全身居中、脚在底部留边；背景实时变化 |
| 自动化 | manual；2026-10-13 小米 6 通过 DocumentsUI 选择 PNG，文件复制到 `/user/backgrounds/` URL 并持久化 |

## TC-AWB-009 横屏聚焦与方向切换动效

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 自动旋转开启或 `settings put system user_rotation 1` |
| 步骤 | 竖屏 → 横屏 → 竖屏 |
| 期望结果 | 人物在 ~600 ms 内平滑放大/缩小到上半身/全身，无跳变；测试后恢复旋转设置 |
| 自动化 | manual |

## TC-AWB-010 横屏左右滑动面板

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 横屏 |
| 步骤 | 向左滑再松手；向右滑；慢速短拖；快甩；拖到一半反向 |
| 期望结果 | 手指跟随；人物与面板实时位移；吸附 left/center/right 带轻微回弹；短拖回弹；一次手势不跨过中间态 |
| 自动化 | manual（调试可用 CDP `Input.dispatchTouchEvent`） |

## TC-AWB-011 应用抽屉

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 设置里开启桌面抽屉 |
| 步骤 | 竖屏上滑；搜索；点击应用；下拉手柄；返回键 |
| 期望结果 | 抽屉跟手弹出/收起；点击应用调用 launchApp；返回键关闭 |
| 自动化 | manual |

## TC-AWB-012 移交：本机离场与入场

| 字段 | 内容 |
|---|---|
| 类型 | e2e / manual-device |
| 前置条件 | 网关 + 桌面端，或 `?debug=1` 的模拟按钮 |
| 步骤 | 点 `host→电脑`，再点 `电脑→本机`；或在电脑端触发 `avatar.transfer` |
| 期望结果 | 离场：下蹲后下滑出屏、回 exited；入场：模型已预载，从下方升起带回弹并 greet、回 entered；非 host 不显示/不发声 |
| 自动化 | manual；模拟：debug 面板 |

## TC-AWB-013 非 host 提示与叫回

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 连接网关且 host 为电脑 |
| 步骤 | 查看本机；点"叫她过来"；长按人物 → 去电脑那边 |
| 期望结果 | 非 host 显示"八千代在电脑上"；按钮触发移交；菜单触发反向移交 |
| 自动化 | manual |

## TC-AWB-014 voice.play 口型同步

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | debug 面板 |
| 步骤 | 点"说话(音频)"，观察口型与回执；模拟 AudioContext options 不支持、resume 后仍 suspended 和 resume 不返回 |
| 期望结果 | 使用 playback latency hint；嘴随音频开合；实际开始后才发布 started；失败/挂起只发布 ended 并释放 speaking；新播放打断旧播放 |
| 自动化 | `test/android-web/audio.test.js`（构造回退、running 检查、超时、误报与占用回归）；真机播放/口型待修复 APK 复测 |

## TC-AWB-015 voice.stream 实时播放

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | 网关实时 TTS |
| 步骤 | 触发 voice.stream.start/chunk/end |
| 期望结果 | PCM 连续无爆音；口型同步；结束回执 |
| 自动化 | manual |

## TC-AWB-016 麦克风按住说话/连续

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | App 内（需麦克风权限） |
| 步骤 | 按住按钮说话并松开；< 280 ms 点击；连续模式开关 |
| 期望结果 | 按住时按钮光圈随音量变化；松手触发识别并显示用户气泡；ASR/Omni 失败时显示结构化错误的 message，不出现 `[object Object]`；误触取消并提示；连续模式按 mic.state 工作 |
| 自动化 | `test/android-web/modelPicker.test.js`（错误展示）+ manual-device |

## TC-AWB-017 聊天气泡与任务画布位置

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | debug 面板 |
| 步骤 | 点"聊天""任务""转写"；设置里切换位置 top/bottom/left/right/hidden |
| 期望结果 | 流式文字、任务卡步骤状态；位置/透明度生效；hidden 不显示 |
| 自动化 | manual |

## TC-AWB-018 设备 RPC 与动作队列

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | 网关调用手机 avatar host |
| 步骤 | `state.get`、`model.motion.play`、`model.expression.set`、`model.param.batchSet`、`live2d.action.enqueue`、`ui.live2d.action` emote happy |
| 期望结果 | 均返回结果；动作执行并在空闲后回到 Idle；非法参数返回 -32602 |
| 自动化 | manual；debug 面板 happy/sad |

## TC-AWB-019 webglcontextlost 重建

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | debug 面板 |
| 步骤 | 点"丢失GL"；锁屏/解锁一次 |
| 期望结果 | 自动重建，人物重新出现且位置/可见性保持；日志含 `rebuilding stage` |
| 自动化 | manual |

## TC-AWB-020 锁屏模式

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | `?mode=lockscreen` |
| 步骤 | 打开页面；尝试滑动/点击；点解锁 |
| 期望结果 | 仅人物、时钟、麦克风；无设置/面板/抽屉/插件 iframe；解锁调用 dismissKeyguard |
| 自动化 | manual |

## TC-AWB-021 设置：连接测试

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 网关运行 |
| 步骤 | 填写地址/端口/token，点测试连接；填错 token；关闭网关 |
| 期望结果 | 分别提示成功 / token 无效 / 超时；状态点变色 |
| 自动化 | manual |

## TC-AWB-022 设置：配置持久化与实时生效

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 主页面与设置页 |
| 步骤 | 改画质、取景、画布位置、麦克风模式，返回主页面 |
| 期望结果 | 配置保存；主页面收到 config.changed 立即生效（画质变化重建模型） |
| 自动化 | manual |

## TC-AWB-023 设置：客户端职责边界

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 安装最新 APK；电脑端网关可连接 |
| 步骤 | 打开手机设置页并检查全部区块；测试服务器连接；搜索构建资产中的模型配置路径和 Provider 凭据字段 |
| 期望结果 | 手机可配置服务器连接、背景、音频、插件、布局与 Launcher；没有模型选择、Provider 或 Provider API key 入口，也不调用 `/api/config/models*` |
| 自动化 | `test/android-web/settingsClientScope.test.js`；最终 APK 真机设置页截图 |

## TC-AWB-024 返回键优先级

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 依次打开菜单/插件 app/抽屉/面板 |
| 步骤 | 连续按返回键 |
| 期望结果 | 按 菜单→app→编辑→抽屉→面板 顺序关闭，最后不消费 |
| 自动化 | manual |

## TC-AWB-025 性能与帧率

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 小米 6，4096 纹理，resolution=2 |
| 步骤 | 静止与交互动画期间用 rAF 计数或 CDP 测帧率 |
| 期望结果 | 静止 ≥ 25 FPS；拖动/移交动画期间模型更新降频、交互帧率明显更高；结果记录在 EXP-20261012 第 6 节 |
| 自动化 | manual；2026-10-13 优化版实测约 22.56 FPS，未达到 60 FPS 目标，未通过 |

## TC-AWB-026 离线 mockNative 运行

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 桌面 Chrome |
| 步骤 | 打开 `http://localhost:8790/web/index.html?debug=1` |
| 期望结果 | 无原生也能完整运行：配置存 localStorage、示例插件可见、debug 面板可模拟移交/语音/聊天 |
| 自动化 | manual |

## TC-AWB-027 夜景主题与受控面板模糊

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 横屏主页面；设置页可打开 |
| 步骤 | 在设置中选择“使用官网夜景”；横向拖出插件/组件面板；观察拖动中与吸附后的面板；检查发布资源目录 |
| 期望结果 | 背景切换为带来源说明的官网宫殿夜景；面板、HUD、设置页使用统一深蓝紫/暖金/淡紫视觉；面板用内部预模糊层且不对 Live2D 使用大型 `backdrop-filter`；发布包不包含该第三方图片副本 |
| 自动化 | `test/android-web/theme.test.js`（来源 URL 与预模糊层性能边界）+ manual-device |

## TC-AWB-028 口型结束中性复位

| 字段 | 内容 |
|---|---|
| 类型 | unit / manual-device |
| 前置条件 | 模型已加载；可播放本地参考 WAV；能读取 Cubism 口型参数 |
| 步骤 | 1) 静音 Idle 15 秒并切换 Greet/Error motion；2) 播放本地参考音频并观察口型；3) 等待播放结束；4) 设置一次 `ParamMouthForm` overlay；5) 再播放一段音频 |
| 期望结果 | 静音及 motion 切换时不自发持续张嘴，连续真实模型更新后 `ParamMouthOpenY`/`ParamMouthForm` 均为 MOC 默认值；播放中嘴形随音频自然变化且优先于 overlay；结束后迅速回到中性；显式 overlay 优先于静音中性层 |
| 自动化 | `test/android-web/lipsync.test.js`、`test/android-web/stageMouth.test.js`（TC-AWB-028）；2026-10-13 在 `ecdfb6b` 完成真机子集（静音 466 次更新全 0/0、播放中动态覆盖、结束后 94 次更新全 0/0）。Greet/ReactError 与显式 overlay 本轮由资源审计和自动化覆盖，尚未单独完成真机手工步骤；详见 `EXP-20261013-android-mouth-neutral.md` |

## TC-AWB-029 跳帧后的 Cubism/physics 步长上限

| 字段 | 内容 |
|---|---|
| 类型 | unit / manual-device |
| 前置条件 | 小米 6 已安装 debug APK；WebView CDP 可连接；舞台发生手势/面板动画并跳过若干模型更新 |
| 步骤 | 连续产生多个 cached-model 帧后恢复完整更新；记录 raw dt、累计 skipped dt、送入模型及 physics 的 dt |
| 期望结果 | 累计时间不会作为一次超大更新送入 Cubism；恢复时只送当前帧 dt，模型与 physics 单步最大 50 ms，且 trace 标记 `clamped=true` |
| 自动化 | `test/android-web/stageContinuity.test.js`；真机数据见 `docs/experiments/EXP-20261013-live2d-body-twitch.md` |

## TC-AWB-030 默认关闭的逐帧连续性 trace

| 字段 | 内容 |
|---|---|
| 类型 | unit / manual-device |
| 前置条件 | debug WebView 可经 CDP 连接；默认 URL 不带 `trace=1` |
| 步骤 | 1) 确认普通运行不采集；2) CDP 调用 `__yachiyoStage.startTrace()`；3) 覆盖 Idle 循环、Greet/ReactError、表情、RPC/动作参数；4) `stopTrace()` 并运行分析脚本 |
| 期望结果 | trace 包含逐帧时间、raw/applied/physics dt、motion 状态变化、表情、focus、overlay/RPC 写入来源、motion 前后与最终参数；分析报告给出各参数最大帧差，功能默认关闭 |
| 自动化 | `test/android-web/stageContinuity.test.js`、`test/android-web/live2dTraceAnalyze.test.js`；采集脚本 `scripts/dev/live2d-trace-capture.js` |

## TC-AWB-031 桌面身体参数单写者与缓释

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | Desktop Live2D 模型已加载，收到非面部 `model.param.set` / `model.param.batchSet` |
| 步骤 | RPC 写入 `ParamBodyAngleX`，推进多个 `beforeModelUpdate`，动作队列回到 Idle 后继续推进 |
| 期望结果 | RPC 时不直接改 coreModel；参数只在 `beforeModelUpdate` overlay 层平滑写入；Idle 复位后权重渐退并最终移除 |
| 自动化 | `test/desktop-live2d/live2dParameterOverlay.test.js` |

## TC-AWB-032 统一主题 token 接入

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 已执行 `npm run android:sync-assets` |
| 步骤 | 检查 `generated/shared/yachiyo-theme.css` 存在；主页面与设置页正常渲染 |
| 期望结果 | 同步脚本复制 `apps/desktop-live2d/shared/theme/yachiyo-theme.css`；`index.html` / `settings.html` 先加载主题再加载自身样式；`app.css` / `settings.css` 只引用 `--y-*` 颜色变量，不再自定义重复色板 |
| 自动化 | `test/android-web/theme.test.js` / Android pages link the shared Yachiyo theme |

## TC-AWB-033 竖屏对话面板不遮脸且可滚动

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 竖屏，人物显示；可通过 CDP 向 WebView 注入 `chat.final` / `chat.delta` / `task.update`（`YachiyoBridge.emitLocal('hub.event', {topic, data})`） |
| 步骤 | 注入多条超长回复；观察面板位置；在面板上上下滑动；上滑后再注入新增量；横屏重复 |
| 期望结果 | 面板在画面下半部，上沿始终低于人物脸部；超长文本在面板内滚动，不触发抽屉/舞台手势；用户上滑后新内容不强制滚到底，自己发送消息后回到底部 |
| 自动化 | `test/android-web/layout.test.js`、`test/android-web/chatPanel.test.js` + manual-device |

## TC-AWB-034 软键盘只上移输入与对话面板

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 竖屏主界面，人物已显示，可通过 CDP 读取元素与 canvas 几何信息 |
| 步骤 | 1) 记录 `#stage`/canvas 外框与人物取景参数；2) 点击输入框弹出键盘；3) 记录输入栏、对话面板与舞台位置；4) 关闭键盘 |
| 期望结果 | Activity 不 resize/pan；人物与舞台前后几何信息完全一致；输入栏和对话面板平滑移到键盘上方，键盘关闭后复位 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/ImeMetricsTest.kt`、`test/android-web/chatPanel.test.js` + manual-device |

## TC-AWB-035 HUD 常驻迁移控件与取消安全

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 主界面连接隔离测试 Hub；可注入 avatar 事件；真机观察时不点击迁移按钮 |
| 步骤 | 1) 切换 connected/disconnected、desktop/mobile owner 和 desktop online/offline 快照；2) 连续点击控件；3) 注入 prepare/enter 后立即注入 failed/cancel；4) 让旧异步模型加载/动画完成 |
| 期望结果 | HUD 文案为「叫回电脑」/「让她过来」并准确显示 owner+pending+在线；pending 期禁止重复 RPC；所有终止路径清理 pending；cancel 后旧 continuation 不发 `entered` |
| 自动化 | `test/android-web/transferControl.test.js`、`test/android-web/avatarOwnerState.test.js` + manual-device |

## TC-AWB-036 脖子线对话框纯函数布局

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 分别输入竖屏、横屏居中、左侧栏、右侧栏、HUD 与全屏插件面板矩形 |
| 期望结果 | 面板上沿不越过模型 bounds 的 24% 脖子线，下沿在输入栏上方；侧栏态在侧栏外；迁移/设置/插件矩形均不重叠，无安全空间时隐藏 |
| 自动化 | `test/android-web/layout.test.js`（B9 portrait / landscape center / open side layouts） |

## TC-AWB-037 对话框跟手与吸附连续插值

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 小米 6 横屏，已有多条对话内容 |
| 步骤 | 左右慢拖并在多个进度连续截图或录屏；分别松手吸附到左右侧栏；检查 `t=0/0.5/1` 及越界输入 |
| 期望结果 | 面板位置、宽高、圆角、不透明度、对齐偏置逐帧连续变化，与人物和侧栏同步；松手使用同一面板弹簧，无跳变；插值端点精确且 t 被限制到 0..1 |
| 自动化 | `test/android-web/layout.test.js`（B9 chat interpolation）+ manual-device |

## TC-AWB-038 对话框四态、方向切换与键盘联合回归

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 小米 6，竖屏/横屏旋转可控，已有长文本，可读取 WebView 元素矩形 |
| 步骤 | 截图竖屏、横屏居中、横屏左滑、横屏右滑四态；连续截图一次横竖屏切换；竖屏弹出键盘并滚动长文本 |
| 期望结果 | 四态均不挡脸，不与输入栏、迁移控件、设置按钮、侧栏或插件面板重叠；方向切换无闪烁跳变；键盘只移动输入和对话区域，长文本仍在面板内滚动且不触发舞台手势 |
| 自动化 | manual；方向初始矩形归一化由 `test/android-web/layout.test.js`（B9 orientation remap）覆盖 |

## TC-AWB-039 横屏居中双列对话与合并过渡

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 小米 6 横屏居中；可注入多轮长回答与用户消息；可读取三套滚动区矩形 |
| 步骤 | 1) 交替注入多轮回答和用户消息；2) 分别上翻左右列后继续注入；3) 左右慢拖到 `t=0.5` 后吸附；4) 从两侧栏反向拖回中心；5) 旋转到竖屏 |
| 期望结果 | 回答只显示在人物左列、用户消息只显示在右列；两列避开模型和全部 HUD、各自滚动且互不改变贴底状态；`t=0/0.5/1` 时双列连续合并为单面板，最终按完整时间顺序显示；吸附及方向切换无跳变 |
| 自动化 | `test/android-web/layout.test.js`（split lanes / split interpolation）、`test/android-web/chatPanel.test.js`（independent lane pinning）+ manual-device |

## TC-AWB-040 横屏分栏边界与侧栏齿轮避让

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 小米 6 横屏居中并有多轮长对话；可用页面状态函数打开左右侧栏，不发送坐标点击 |
| 步骤 | 1) 记录脸部保护线与双列矩形；2) 检查两列宽度、中缝和上边界；3) 分别打开左右侧栏并记录设置齿轮与侧栏矩形；4) 截图复核脸部与长文区 |
| 期望结果 | 双列从脸部保护线下 16 px 开始，不遮挡脸部；左右各填满半屏并中留 16 px，可覆盖下半身；任一侧栏终态齿轮均在面板内容外，右侧插件栏展开过程中齿轮与面板同步移动 |
| 自动化 | `test/android-web/layout.test.js`（wide lower-screen lanes / face protection / settings shift）+ manual-device |

## TC-AWB-041 Realtime 对话 trace 隔离与最终事件幂等

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 可注入带不同 `trace_id` 的 `chat.delta/chat.final`；Realtime 模型可用 |
| 步骤 | 交错发送两个 trace 的增量；对其中一个 trace 连续发送两次相同 final；再完成另一个 trace |
| 期望结果 | 两个回答分别形成完整气泡且内容不交错；重复 final 不创建第二张气泡；后续新 trace 仍正常显示 |
| 自动化 | `test/android-web/chatPanel.test.js`（assistant bubbles are trace-aware and duplicate final events are idempotent）+ manual-device |

## TC-AWB-042 聊天气泡独立自动收起

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 可注入两个带不同 `trace_id` 的回答；首个回答已收到 `chat.final` |
| 步骤 | 首个回答进入淡出等待后，立即让第二个回答持续发送 `chat.delta`；等待首个回答的展示时限与 420 ms 淡出动画 |
| 期望结果 | 首个回答按时淡出并从 DOM 移除；第二个回答继续显示；画布在仍有内容时保持可见 |
| 自动化 | `test/android-web/chatPanel.test.js`（a newer streamed reply does not cancel an older bubble fade timer）+ manual-device |

## TC-AWB-043 中断的流式回答超时收起

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 可注入带 `trace_id` 的 `chat.delta`，不发送 `chat.final` |
| 步骤 | 发送一次增量，30 s 内再发送一次，然后停止发送并等待 30 s + 420 ms |
| 期望结果 | 第二次增量重置超时；最后一次增量 30 s 后气泡开始淡出，420 ms 后从 DOM 移除，不会永久停留 |
| 自动化 | `test/android-web/chatPanel.test.js`（an interrupted assistant stream expires after 30 seconds without a final event）+ manual-device |

## TC-AWB-044 任务重试错误合并显示

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 同一 `task_id` 的 `task.update` 含多个名称与状态相同的失败步骤 |
| 步骤 | 连续加入三次 `shell.exec failed`，中间穿插其他成功步骤；显示任务卡 |
| 期望结果 | 三个失败步骤合并为一行 `shell.exec ×3`；其他不同步骤保留；任务卡最多显示最近 4 个不同状态 |
| 自动化 | `test/android-web/chatPanel.test.js`（repeated task failures are compacted into one counted row）+ manual-device |

## TC-AND-053 手机聊天模型选择与音频模式

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | Device Hub 已连接；电脑已启用普通文本、Omni direct、Omni realtime 模型 |
| 步骤 | 打开聊天栏切换三种模型；分别发送文字与按住说话；检查 Hub 帧 |
| 期望结果 | 手机只显示已启用模型；主界面常驻显示当前模型及“转写 / 直通 / 实时”徽标且点击可打开聊天；文字携带 `model_ref`；麦克风携带正确 `audio_mode`；`available=false` 的模型显示为不可用且不能选中或启动录音；结构化错误显示可读 `message`；页面没有 provider/key/配置 API |
| 自动化 | `test/android-web/modelPicker.test.js`；真机语音为 manual-device |

## TC-AWB-045 会话权限状态归一化

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 输入合法/非法策略；新增、覆盖、排序、移除待审批请求；检查过期时间 |
| 期望结果 | 非法策略回退 `manual`；相同 ID 不重复；请求按创建时间排序；过期请求可识别 |
| 自动化 | `test/android-web/sessionApproval.test.js`（session approval normalizes modes and pending requests） |

## TC-AWB-046 Android 权限面板协议接线

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 静态检查主页面、控制器与样式中的四个会话 RPC、两个审批事件、脚本加载顺序与锁屏规则 |
| 期望结果 | 主页面具有三档权限、待审批入口及高斯模糊；锁屏隐藏入口；RPC 与事件均已接线 |
| 自动化 | `test/android-web/sessionApproval.test.js`（Android main screen wires scoped session policy and approval events） |

## TC-AWB-047 Android 真机会话审批

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 小米 6 通过 Wi-Fi ADB 连接，网关可访问，手机已配对 |
| 步骤 | 打开盾牌面板；依次切换每次询问/自动批准/完全访问并重开面板；在每次询问下触发需审批命令并分别允许、拒绝；断开并重连 Hub |
| 期望结果 | 策略服务端持久化；待处理徽标与列表及时出现和消失；决定只作用于 `device-<id>`；重连后恢复权威状态；界面不遮挡人物脸部且可滚动 |
| 自动化 | manual；RPC 隔离由 `test/gateway/deviceHub/runtimeBridge.test.js` 覆盖 |

## TC-AWB-048 桌面设备动态上线刷新迁移按钮

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 手机已连接 Device Hub，角色当前在手机，桌面端尚未启动 |
| 步骤 | 确认手机显示「电脑离线」；启动桌面 Electron；接收 `sys.device.online`；点击「叫回电脑」 |
| 期望结果 | 手机无需重连即显示「电脑在线」，按钮立即启用；重复上线不产生重复设备；离线后按钮重新禁用；点击后完成手机到桌面的迁移 |
| 自动化 | `test/android-web/transferControl.test.js`（device presence events immediately refresh desktop availability）+ manual-device |

## TC-AWB-049 独立消息框事件显示

| 字段 | 内容 |
|---|---|
| 类型 | unit + integration |
| 前置条件 | Pi 会话可调用 `ui.chat.post` |
| 步骤 | 模型发布显式消息；另一次不调用消息工具而只返回 final |
| 期望结果 | `ui.chat.post` 作为完整回答显示一次；内部工具确认不重复显示；未调用消息工具的 final 仍由兼容 `chat.final` 显示一次 |
| 自动化 | `test/android-web/uiChatDelivery.test.js`, `test/gateway/deviceHub/runtimeBridge.test.js` |

## TC-AWB-050 完整消息气泡有界自动收起

| 字段 | 内容 |
|---|---|
| 类型 | unit + manual-device |
| 前置条件 | 回答只收到 `ui.chat.post` 或 `chat.final`，没有先收到流式 delta |
| 步骤 | 显示一条足够长的完整回答并等待 24 s + 420 ms 淡出动画 |
| 期望结果 | 气泡最迟 24 s 开始淡出并移除；它是最后一条消息时画布同步隐藏 |
| 自动化 | `test/android-web/chatPanel.test.js`（TC-AWB-050 a direct final-only message always fades within 24 seconds）+ manual-device |
