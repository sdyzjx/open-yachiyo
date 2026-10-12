# Android 客户端构建与真机调试指南

> 类型: guide
> 状态: active
> 负责人: sonnet-ws4
> 更新: 2026-10-12
> 关联: apps/android/, docs/features/FEAT-android-native-shell.md, docs/testing/TC-android-native.md

## 1. 环境

| 项 | 要求 |
|---|---|
| JDK | 17（`export JAVA_HOME=<jdk17>`） |
| Android SDK | platform 35、build-tools 35（`compileSdk 35`） |
| Gradle | 通过 `apps/android/gradlew`（wrapper 8.12）；AGP 8.7.0，Kotlin 2.1.0 |
| 依赖 | `androidx.webkit:webkit`、`okhttp 4.12.0`、`androidx.core:core-ktx`；测试：`junit`、`org.json`、`mockwebserver` |

在 `apps/android/local.properties` 写入 `sdk.dir=<SDK 路径>`（该文件被 `.gitignore` 忽略，不得提交）。仅 `arm64-v8a`，无需 NDK。

## 2. 构建与测试

```bash
cd apps/android
export JAVA_HOME=/path/to/jdk17
./gradlew :app:testDebugUnitTest :app:assembleDebug   # 提交前必须通过
# APK: app/build/outputs/apk/debug/app-debug.apk
```

`app/src/main/assets/generated/`（Live2D 库与模型，由 `scripts/android-sync-assets.js` 生成）与 `assets/web/`（WS5 的前端）不由原生壳提交；缺少 `assets/web/index.html` 时 App 加载内置 `assets/fallback/index.html` 桥接测试页。

## 3. 安装与运行

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
$ADB -s <serial> install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
$ADB -s <serial> shell pm grant com.yachiyo.companion android.permission.POST_NOTIFICATIONS   # 可选
$ADB -s <serial> shell am start -n com.yachiyo.companion/.MainActivity
$ADB -s <serial> logcat -s HubClient HubService PluginPush YachiyoWeb YachiyoWebConsole AndroidRuntime
$ADB -s <serial> exec-out screencap -p > /tmp/screen.png
```

多个设备/传输（USB 与 Wi-Fi ADB）同时存在时务必使用 `-s <serial>`。

## 4. 连接网关

1. 电脑端 `npm run dev`（`0.0.0.0:3000`），手机与电脑在同一局域网；
2. 手机端配置 `server.host/port/token`（默认 `192.168.20.212:3000`，无令牌），通过 Web 配置页或 Bridge `setConfig`；
3. 令牌来自网关 `GET /api/device/pairing`（仅 localhost）。令牌错误时状态为 `unauthorized`，不会重试。

网关 Device Hub 未就绪时，可用任意实现 C1 的假服务端联调（见 `TC-AND-018`：Node + `ws` 即可）。

## 5. WebView 调试

debug 构建开启 `WebView.setWebContentsDebuggingEnabled(true)`：桌面 Chrome 打开 `chrome://inspect`，或 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`。Web `console.*` 同时写入 logcat（tag `YachiyoWebConsole`）。

## 6. 默认桌面与锁屏

- 设为默认桌面：系统设置 → 应用 → 默认应用 → 主屏幕应用，选 Yachiyo；或在 App 内调 `YachiyoNative.openHomeSettings()`。
- 锁屏人物：`YachiyoNative.setLockscreenEnabled(true)` 后息屏再亮屏验证；在无锁屏密码的设备上返回键即可回到桌面。**测试结束务必关闭**（或 `adb shell run-as com.yachiyo.companion rm shared_prefs/yachiyo.xml` 清配置），否则会影响同一设备上其他调试。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| `Plugin ... was not found`（Gradle） | 需联网下载 AGP；不要加 `--offline` |
| 页面白屏 | 看 logcat `YachiyoWebConsole`；确认 `assets/web/index.html` 或内置页存在 |
| 麦克风无声 | 确认已授予 `RECORD_AUDIO`，且 Hub 状态为 `connected` |
| 锁屏不弹出 | 检查是否开启 `lockscreen.enabled`、前台服务在运行；部分 ROM 需允许"全屏通知" |
