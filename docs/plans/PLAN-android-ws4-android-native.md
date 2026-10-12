# WS4 施工文档：Android 原生壳（Kotlin）

> 类型: plan
> 状态: active
> 负责人: sonnet-ws4
> 更新: 2026-10-12
> 关联: PLAN-android-companion-contracts.md §C1 §C2 §C3 §C6

## 1. 目标

构建 Android 应用 `com.yachiyo.companion`：WebView 宿主（加载 WS5 的前端）、与电脑端 Device Hub 的 WebSocket 长连接（前台服务）、JS Bridge、麦克风采集上行、插件包安装与本地服务、配置持久化、默认桌面（Launcher）接管、锁屏显示人物。

## 2. 环境

- Android SDK：`~/Library/Android/sdk`（platforms 34/35/36，build-tools 34/35/36）；JDK 17：`/Users/doosam/Library/Java/JavaVirtualMachines/ms-17.0.16/Contents/Home`
- Gradle 本地缓存已有：Gradle 8.12 wrapper、AGP 8.7.0、Kotlin 2.1.0、OkHttp 4.12.0；可联网下载其他依赖（`androidx.webkit:webkit`、`androidx.appcompat` 等）
- 目标设备：Xiaomi MI 6，Android 15（SDK 35），1080×1920，6 GB RAM；`adb` 在 `~/Library/Android/sdk/platform-tools/adb`，设备序列号 `ca1e5d8b`
- `minSdk 26`，`targetSdk 35`，`compileSdk 35`；仅 `arm64-v8a` 无需 NDK

## 3. 负责路径

`apps/android/**`，**除了** `app/src/main/assets/web/**` 与 `sample-plugins/**`（WS5）。
`apps/android/.gitignore` 需忽略 `build/`、`.gradle/`、`local.properties`、`app/src/main/assets/generated/`。

## 4. 任务与提交点

| # | 任务 |
|---|---|
| 1 | Gradle 工程骨架（Kotlin DSL、wrapper 8.12、AGP 8.7.0、Kotlin 2.1.0）、`MainActivity` 全屏沉浸式 WebView，`WebViewAssetLoader` 路径映射（契约 C6），硬件加速，`setMediaPlaybackRequiresUserGesture(false)`，debug 构建开启 WebView 调试；若 `assets/web/index.html` 不存在则显示内置占位页。`./gradlew assembleDebug` 通过并真机启动 |
| 2 | 配置存储 `ConfigStore`（契约 C2.3 默认值、浅合并、变更广播）；`device_id` 生成持久化 |
| 3 | `HubClient`（OkHttp WebSocket）：信封（契约 C1.2）、hello、心跳、指数退避重连、订阅表重连后恢复、RPC 关联与超时；运行在前台服务 `HubService`（通知常驻，`FOREGROUND_SERVICE_TYPE_MICROPHONE|MEDIA_PLAYBACK|CONNECTED_DEVICE` 按需）；Activity 绑定服务 |
| 4 | JS Bridge `YachiyoNativeBridge`（契约 C2.1 全部方法，C2.2 全部事件；页面加载前事件排队；主线程/后台线程安全）；返回键协议 |
| 5 | 原生设备方法注册（契约 C1.6，`expose_as_tool: true`）：`device.vibrate`、`device.battery.get`、`device.toast`、`device.screen.wake`、`device.info`；网关发来的 live2d 方法转交 Web 前端处理 |
| 6 | 麦克风：`RECORD_AUDIO` 运行时权限；`AudioRecord` 16 kHz 单声道 PCM16，100 ms 分块经 Hub 上行（契约 C1.7）；`mic.level` RMS 事件；按住说话 / 连续模式（连续模式用简单能量 VAD：静音 800 ms 结束一段） |
| 7 | 插件管理 `PluginManager`：从 URI（SAF 选择器）或下载 URL 安装 `.yplug/.zip`；zip 路径穿越防护；manifest 校验（契约 C3.1）；安装到 `files/plugins/<id>/`；列表/卸载/启用；插件 KV 存储；处理 `plugin.install` 推送（下载带 token、校验 sha256、回执 `plugin.installed` / `plugin.install_failed`）；锁屏模式拒绝 |
| 8 | 背景图选择：复制到 `files/user/backgrounds/`，返回 `https://appassets.androidplatform.net/user/backgrounds/<file>` |
| 9 | Launcher：`MainActivity` 增加 `HOME`/`DEFAULT` intent-filter（`launcher.enabled` 只控制 UI 行为，系统默认桌面由用户在系统设置选择，`openHomeSettings()` 跳转 `Settings.ACTION_HOME_SETTINGS`）；作为桌面时返回键不退出；实现契约 C2.1 的 `listLaunchableApps()` / `launchApp(package)` 与 C6 的 `/appicon/` 路径 |
| 10 | 锁屏：`LockscreenActivity`（`setShowWhenLocked(true)`、`setTurnScreenOn(true)`），复用同一 Web 前端，以 `mode=lockscreen` 加载（URL 参数 `?mode=lockscreen`）；屏幕关闭广播时（`lockscreen.enabled` 为真）预启动；Hub 发送 `sys.device.mode`；锁屏模式 Bridge 拒绝插件相关方法 |
| 11 | 屏幕方向：`setOrientation(auto|portrait|landscape)`；配置变化不重建 WebView（`configChanges` 包含 orientation/screenSize）；向 Web 发送 `lifecycle` |
| 12 | 单元测试（JVM）：配置合并、信封编解码、zip 安装与路径穿越、manifest 校验、PCM 分块与 RMS、重连退避计算；`./gradlew :app:testDebugUnitTest` |
| 13 | 文档：`docs/features/FEAT-android-native-shell.md`、`FEAT-android-launcher-lockscreen.md`、`docs/guides/ANDROID_BUILD_GUIDE.md`、`docs/testing/TC-android-native.md`（`TC-AND-001…`，含真机手工用例）；`npm run docs:index` |

每项完成即 commit；每次 commit 前 `./gradlew :app:testDebugUnitTest :app:assembleDebug` 通过。阶段性在真机安装验证（`adb install -r`），截图可用 `adb exec-out screencap -p > /tmp/x.png`。

## 5. 联调说明

WS5 的前端在 `app/src/main/assets/web/` 由另一个 agent 并行开发；你只需保证 Bridge 契约。可写一个最小 `assets/web/` 占位页用于自测，但**不要提交** `assets/web/` 下的文件（由 WS5 负责）；占位页放在 `app/src/main/assets/fallback/index.html`。

## 6. 待统筹决策

以下是实现中对契约的解释/扩展，请统筹者确认并在契约文档中固化（WS5 需对齐）：

1. **C2.2 `dispatch` 参数**：原生以**对象**调用 `window.__yachiyoNative.dispatch({type, data})`（不是 JSON 字符串）。若 `dispatch` 尚未定义，消息写入 `window.__yachiyoQueue`（数组），前端定义 `__yachiyoNative` 后应排空。建议 Web 的 `dispatch` 同时接受对象和字符串。
2. **`plugins.changed` 的 `data`** 为插件**数组**（同 `listPlugins()`），不是 `{plugins:[]}`。
3. **`setConfig` 合并语义**：C2.3 写"浅合并"；实现为递归对象合并（数组整体替换），使 `appearance.background` 等嵌套对象可局部更新。如需严格浅合并请告知。
4. **`hub.rpc.result.result`** 可为任意 JSON 值（对象/数组/标量），原样透传网关 `rpc.res.data.result`。
5. **新增 Bridge 方法 `dismissKeyguard()`**（契约外，仅锁屏 Activity 有效）：锁屏页提供"解锁"手势/按钮时调用。返回键在锁屏页默认也会触发解锁。
6. **`mic.state` 语义**：按住说话 `micStart→recording`、`micStop→uploading→idle`；连续模式有语音段时 `recording`（带 `stream_id`），段间 `idle`。
7. **`is_default_launcher`** 使用 `RoleManager.isRoleHeld(ROLE_HOME)`（`resolveActivity` 在多桌面共存时会误报）。
8. **设置页** 由独立的 `SettingsActivity`（自带 WebView 与 Bridge，加载 `/web/settings.html?mode=normal`）承载；`openSettings()` 启动它，`closeSettings()` 结束它，主页面（人物舞台）不重载，会收到 `config.changed`。若 `assets/web/settings.html` 不存在则加载内置 fallback 页（`?page=settings`）。
9. **HubClient 为进程单例**（`CompanionApp.hub`），`HubService` 只做保活/通知/锁屏预启动；未采用"Activity 绑定服务"。
10. **锁屏启动**：息屏时 `HubService` 直接 `startActivity(LockscreenActivity)` 并附带全屏意图通知（`USE_FULL_SCREEN_INTENT`）作为备用；在 MI 6 / Android 15 上有效，其他 ROM 可能需要用户授权。
11. **`hello.mode`** 取 `HubClient.currentMode`（LockscreenActivity 创建时置 `lockscreen`、销毁时置 `normal`），重连时仍正确。
12. 网关 `plugin.install.url` 允许相对路径（以 `http://<host>:<port>` 补全）；下载携带 `Authorization: Bearer <server.token>`。

## 7. 交付记录

**完成项（任务 1–13 全部完成）与提交**

| 提交 | 内容 |
|---|---|
| 8802421 | 任务 1：Gradle 骨架（wrapper 8.12/AGP 8.7.0/Kotlin 2.1.0）、沉浸式 WebView、C6 资源映射、fallback 页 |
| 37870bf | 任务 2：ConfigStore（C2.3 默认值、递归合并、广播、device_id） |
| e8fab80 | 任务 3：HubClient（信封/hello/心跳/退避/订阅恢复/RPC）+ HubService 前台服务 + MockWebServer 测试 |
| 48e01c5 | 任务 4：YachiyoNativeBridge（C2.1 全部方法、C2.2 全部事件、事件排队、返回键协议）、SettingsActivity |
| ae106e8 | 任务 5：device.vibrate/battery.get/toast/screen.wake/info（expose_as_tool） |
| e6e23b7 | 任务 6：麦克风（RECORD_AUDIO、16 kHz PCM16、100 ms 分块、RMS、按住说话/连续 VAD） |
| 1363522 | 任务 7+8：PluginManager/Installer/PushHandler、KV、背景图选择 |
| 3398c0a | 任务 9：Launcher（HOME filter、应用列表、/appicon/） |
| 28f40ac | 任务 10+11：LockscreenActivity、屏幕方向、lifecycle（含 screen_on/off） |
| dcaa993 | 任务 12+13：文档（FEAT×2、BUILD_GUIDE、TC-AND-001…035）与 docs 索引 |

单元测试（任务 12）与各功能随提交一同提交；文档统一在最后一次提交（偏离"每次提交含文档"的要求，内容覆盖全部功能）。JVM 测试共 60+ 个：配置、信封/退避、HubClient（11 个）、Dispatcher、设备方法、音频流水线、插件（15 个）、路径安全、包名。

**真机验证（MI 6，Android 15，经 Wi-Fi ADB）**：安装启动、沉浸式 fallback 页与桥接事件；与 Node 假 Hub 联调（hello/sub/register、device.* RPC、越界 -32602、plugin.install 成功与 sha 错误、plugin.installed/install_failed 回执）；麦克风 mic.level 与 audio.input.chunk 上行；`setLockscreenEnabled` 后息屏→亮屏显示 LockscreenActivity 并发布 `sys.device.mode=lockscreen`；返回键解锁结束锁屏；横屏切换不重建；`is_default_launcher` 判定修复。测试结束已清理应用配置并关闭锁屏。

**未完成 / 未在真机验证**：
- 与 WS5 实际前端的联调（本分支无 `assets/web/`，仅用 fallback 页）。
- 真机上：SAF 选包安装、背景图选择、`/plugins/` 路径实际加载、锁屏模式下插件隔离的 Web 层表现、设为默认桌面后的返回键、应用图标渲染（单元测试覆盖路径/包名校验，逻辑已实现）。
- 后台启动锁屏在其他 ROM 的兼容性；开机自启未实现。
- 与真实 WS3 网关的联调（仅假服务端）。

**风险**：
- 前台服务 microphone 类型在 Android 14+ 需前台时启动，后台启动麦克风可能被拒。
- 简单能量 VAD 在嘈杂环境不稳。
- Bridge 约定（见 §6）需 WS5 对齐，尤其是 `dispatch` 入参为对象与 `plugins.changed` 为数组。

**如何验证**：见 `docs/guides/ANDROID_BUILD_GUIDE.md` 与 `docs/testing/TC-android-native.md`。自动：`cd apps/android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`；真机：安装 APK 后用 fallback 页按钮逐项点击（deviceInfo/hubState/micStart/apps/landscape/lockscreen on），并用任意实现 C1 的服务端（Node + ws）观察帧。
