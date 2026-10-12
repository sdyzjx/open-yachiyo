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

## 7. 交付记录
