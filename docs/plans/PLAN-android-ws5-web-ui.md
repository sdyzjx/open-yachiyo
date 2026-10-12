# WS5 施工文档：Android Web 前端（Live2D 舞台 / 手势布局 / 插件宿主 / 配置界面）

> 类型: plan
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: PLAN-android-companion-contracts.md §C1 §C2 §C3 §C6, EXP-20261012-android-live2d-webview-feasibility.md

## 1. 目标

在 Android WebView 中实现全部可视化交互：Live2D 渲染（复用桌面端动作/口型模块）、竖屏/横屏布局与动效、左右滑面板（插件入口 / 桌面组件）、移交入场/离场动画、TTS 播放与口型、任务画布、插件宿主与插件 SDK、Launcher 应用抽屉、统一配置界面；以及资源同步脚本。

## 2. 负责路径

- `apps/android/app/src/main/assets/web/**`（入库）
- `apps/android/sample-plugins/**`（示例插件：至少 1 个 app、1 个 widget）
- `scripts/android-sync-assets.js`（生成 `assets/generated/`，契约 C6）
- `test/android-web/**`（Node `node:test` 可测的纯逻辑模块：手势状态机、布局计算、主题匹配、SDK 消息协议）
- 不得修改 `apps/android/` 下其他路径（WS4）及电脑端代码

## 3. 技术约束

- 纯原生 JS（ES2020，无构建步骤），模块用 `<script>` 顺序加载或 ES module 均可；可测试的纯逻辑写成 UMD 风格（同时支持浏览器全局与 `require`），参考 `apps/desktop-live2d/shared/live2dActionMessage.js`。
- 渲染：`pixi.js@6` + `pixi-live2d-display` cubism4 + Cubism Core（由同步脚本放入 `generated/lib/`）。
- 复用桌面模块（同步脚本复制到 `generated/shared/`）：`live2dActionMessage.js`、`live2dActionMutex.js`、`live2dActionQueuePlayer.js`、`live2dActionExecutor.js`、`lipsyncViseme.js`、`lipsyncMouthTransition.js`。阅读 `apps/desktop-live2d/renderer/bootstrap.js` 中它们的用法（`ensureActionQueuePlayer`、口型驱动），在移动端按相同方式装配，**不要复制 bootstrap.js 整体**。
- 实验结论：纹理 4096（低内存 2048）；`resolution = min(dpr, 2)`；模型必须在入场动画前预加载；监听 `webglcontextlost` 并重建。
- 原生能力一律通过 `window.YachiyoNative`（契约 C2.1）；开发期提供 `js/mockNative.js`：当 `YachiyoNative` 不存在时启用，模拟配置、并可直接用浏览器 WebSocket 连接网关 `/ws/device`（便于在桌面 Chrome 与真机浏览器中调试）。

## 4. 任务与提交点

| # | 任务 |
|---|---|
| 1 | `scripts/android-sync-assets.js`：复制 pixi / cubism4 / 桌面共享模块；下载 Cubism Core（缓存到 `~/.cache/yachiyo/`，失败时给出清晰提示）；模型降采样到 4096 与 2048（macOS 用 `sips -Z`，其他平台若无可用工具则复制原图并警告）；修正 `model3.json` 纹理路径；输出清单 `generated/manifest.json`。在 `package.json` 增加 `android:sync-assets` 脚本 |
| 2 | 舞台 `js/stage.js`：Pixi 应用、模型加载（质量档按 `getDeviceInfo().low_ram` / 配置）、相机系统（目标框：竖屏全身；横屏上半身聚焦——以模型 bounds 的上 55% 为取景框），所有相机变化用弹簧/缓动插值；idle 动作；点击头部/身体互动；`webglcontextlost` 重建 |
| 3 | 动作与 RPC：处理 `hub.rpc.request` 中的 `state.get`、`model.motion.play`、`model.expression.set`、`model.param.set`、`model.param.batchSet`、`live2d.action.enqueue`，以及 `hub.event` 的 `ui.live2d.action`；结果经 `hubRpcRespond` |
| 4 | 布局与手势 `js/layout.js`（纯逻辑可测）：竖屏全身 + 背景（颜色/图片，配置）；横屏默认居中，**左滑 → 人物左移，右侧空出区域显示插件入口网格**；**右滑 → 人物右移，左侧空出区域显示桌面组件**；手指跟随（拖动时人物与面板实时位移）、松手按速度/位移阈值吸附到 left / center / right 三态，带回弹；方向切换时有聚焦动效（全身 ↔ 上半身，~600 ms）；Launcher 模式下竖屏上滑打开应用抽屉（`listLaunchableApps`） |
| 5 | 移交动画（契约 C1.5）：`avatar.transfer.prepare` → 预加载并置于屏幕下方 → `ready`；`exit` → 下蹲后下滑离场 → `exited`；`enter` → 下方升起回弹 + greet → `entered`；`cancel` 恢复；非 host 时隐藏人物并显示「八千代在电脑上」小提示与「叫她过来」按钮（调用 `hubRpc avatar.transfer {to: 本机}`）；人物长按菜单「去电脑那边」 |
| 6 | 音频：`voice.play`（fetch 带 token → WebAudio 播放 → 口型：RMS/viseme 驱动 `ParamMouthOpenY` 等，复用 `lipsyncViseme`）；`voice.stream.*` PCM 实时播放（参考桌面 `realtimeVoicePlayer.js`）；播放回执 `voice.playback.started/ended`；麦克风按钮（按住说话 / 连续模式）调用 `micStart/micStop`，显示 `mic.level` 波形；`audio.input.transcript` 显示为用户气泡 |
| 7 | 任务画布 / 聊天气泡：订阅 `chat.delta`、`chat.final`、`task.update`；位置按配置 `task_canvas.position`（top/bottom/left/right/hidden）；文本输入框发送 `chat.input` |
| 8 | 插件宿主 `js/pluginHost.js`：app 入口网格（左滑区域）、app 打开（在空出区域内全屏/半屏 iframe，可关闭），widget 网格（右滑区域，按 `widget_layout` 布局，可长按拖动调整并保存）；iframe `sandbox`（契约 C3.2）；postMessage 协议（C3.3）与权限校验（C3.1 permissions）；锁屏模式不加载插件 |
| 9 | 插件 SDK `web/sdk/yachiyo-plugin-sdk.js`（契约 C3.4 全部 API）+ `docs/guides/PLUGIN_DEVELOPMENT_GUIDE.md`；示例插件：`sample-plugins/pomodoro`（app：番茄钟，结束时让八千代做动作，注册 `start_timer` 工具暴露给 agent）、`sample-plugins/clock-widget`（widget：时钟 + 订阅 `task.update` 显示当前任务） |
| 10 | 配置界面 `settings.html`：服务器地址/端口/token（含连接测试与状态）、背景（颜色/选图）、模型画质、任务画布位置、麦克风模式、屏幕方向、插件管理（导入 `pickPluginPackage`、列表、启用、卸载）、默认桌面（状态 + 跳转设置）、锁屏人物开关；**模型配置**：读取 `GET http://<server>/api/config/models`（契约 C4.4），可切换 active 模型与启用模型（`PUT /api/config/models/selection`），离线时隐藏该区块 |
| 11 | 锁屏模式（`?mode=lockscreen`）：仅人物 + 麦克风 + 语音 + 时间，无插件区与设置入口 |
| 12 | Node 单测：手势状态机（阈值、速度吸附）、相机取景计算、主题通配匹配、SDK 消息校验与权限判断；`npm run test:ci` 需包含（文件放 `test/android-web/*.test.js`） |
| 13 | 文档：`docs/features/FEAT-android-live2d-stage.md`、`FEAT-android-gesture-layout.md`、`FEAT-plugin-system.md`、`FEAT-android-settings.md`；`docs/testing/TC-android-web.md`（`TC-AWB-001…`，含真机手工用例）、`TC-plugin-system.md`（`TC-PLG-001…`）；实验文档第 6 节追加 App 内复测结果（如可测）；`npm run docs:index` |

每项完成即 commit（代码 + 测试 + 文档）。

## 5. 调试方法（无需等待 WS4）

1. `npm run android:sync-assets`
2. 在仓库根目录起静态服务，把 `apps/android/app/src/main/assets/` 作为根（让 `/web/`、`/generated/`、`/sdk/` 路径与 App 内一致；`/sdk/` 映射到 `web/sdk/`）
3. 桌面 Chrome 打开 `http://localhost:<port>/web/index.html`（mockNative 生效）
4. 真机：`adb reverse tcp:<port> tcp:<port>` 后执行 `adb shell am start -a android.intent.action.VIEW -d 'http://localhost:<port>/web/index.html' org.lineageos.jelly`；横竖屏可用 `adb shell settings put system user_rotation 1` + `accelerometer_rotation 0` 切换；截图 `adb exec-out screencap -p > /tmp/s.png`
5. 网关联调：`npm run dev` 后 mockNative 连接 `ws://<mac-ip>:3000/ws/device`（WS3 未合并前可跳过）

## 6. 待统筹决策

## 7. 交付记录
