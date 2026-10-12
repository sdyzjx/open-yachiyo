# Android Web 前端测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/features/FEAT-android-live2d-stage.md, docs/features/FEAT-android-gesture-layout.md, docs/features/FEAT-android-settings.md, test/android-web/

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
| 自动化 | manual |

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
| 步骤 | 点"说话(音频)"，观察口型与回执 |
| 期望结果 | 嘴随音频开合；结束后平滑闭合；发布 `voice.playback.started/ended`；新播放打断旧播放 |
| 自动化 | manual |

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
| 期望结果 | 按住时按钮光圈随音量变化；松手触发识别并显示用户气泡；误触取消并提示；连续模式按 mic.state 工作 |
| 自动化 | manual |

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

## TC-AWB-023 设置：模型配置区块

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | 网关含 /api/config/models（WS2） |
| 步骤 | 打开设置；切换当前模型、启用模型；断网重开 |
| 期望结果 | 列表来自网关；PUT selection 生效；离线时区块隐藏 |
| 自动化 | manual |

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
| 前置条件 | 小米 6，包含 Worker Core 性能实现的集成 APK |
| 步骤 | 建立临时 CDP forward；运行 `node scripts/android-profile-live2d.js --port <port> --duration 5`，再加 `--swipe` 运行一次；播放 motion/语音并观察呼吸、头发、衣摆与口型 |
| 期望结果 | rAF 与真实 WebGL draw 稳态目标均 ≥ 60 FPS；Worker frame 持续增长；人物逐帧形变、没有冻结或抽动；结果如实记录在 `EXP-20261012-android-live2d-performance.md` |
| 自动化 | manual |

## TC-AWB-026 离线 mockNative 运行

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 桌面 Chrome |
| 步骤 | 打开 `http://localhost:8790/web/index.html?debug=1` |
| 期望结果 | 无原生也能完整运行：配置存 localStorage、示例插件可见、debug 面板可模拟移交/语音/聊天 |
| 自动化 | manual |

## TC-AWB-027 Cubism Worker 主线程桥接

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | fake Worker、typed-array drawable 模型 |
| 步骤 | 初始化；ready 前调用 update；连续发送两个 frame；推进插值时间；模拟启动/单帧无响应及页面后台恢复；再次 update；销毁 |
| 期望结果 | ready 前同步回退；首帧后不再同步 Core；worker 到达不跳网格；显示帧生成中间顶点与透明度并保持 mask vertex-changed；上一组 typed array 返回 Worker 池；可见页面超时回退同步 Core，后台时间不误判且恢复后重置截止期；Worker 释放 |
| 自动化 | `test/android-web/live2dPerformance.test.js`（TC-AWB-027） |

## TC-AWB-028 Cubism Worker 求值协议

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | VM 内 fake Cubism Core、模型与 fetch |
| 步骤 | init 加载 moc；发送参数与部件透明度；执行 Core update |
| 期望结果 | ready 报告形状；预留 64 MiB heap；frame 返回完整 transferable typed arrays、参数回收 buffer 与耗时；下一帧复用回收数组；destroy 释放 model 与 moc |
| 自动化 | `test/android-web/live2dPerformance.test.js`（TC-AWB-028） |

## TC-AWB-029 Cubism packed renderer

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | fake WebGL context、两个 drawable、原 renderer draw 顺序 |
| 步骤 | 安装 optimizer；绘制两帧；检查 attrib/index offset、上传次数和 program；触发 draw 异常；detach |
| 期望结果 | UV/index 只上传一次、position 每模型帧一次；draw 顺序不变；透明非 mask drawable 可跳过；真实 draw 异常不重试；GL 方法、原 `_bufferData` 和自有 buffer 正确恢复/释放 |
| 自动化 | `test/android-web/live2dRendererOptimizer.test.js` |
