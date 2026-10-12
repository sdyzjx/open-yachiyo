# Android 原生壳测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-ws4
> 更新: 2026-10-12
> 关联: docs/features/FEAT-android-native-shell.md, docs/features/FEAT-android-launcher-lockscreen.md, docs/plans/PLAN-android-ws4-android-native.md

执行：自动用例 `cd apps/android && ./gradlew :app:testDebugUnitTest`；真机用例见 `docs/guides/ANDROID_BUILD_GUIDE.md`（多传输时用 `adb -s <serial>`）。ID 范围 `TC-AND-001` … `TC-AND-043`。

## 用例

### TC-AND-001 工程构建与单元测试全绿

| 字段 | 内容 |
|---|---|
| ID | TC-AND-001 |
| 标题 | 工程构建与单元测试全绿 |
| 类型 | unit |
| 前置条件 | JDK 17、SDK 35 |
| 步骤 | `cd apps/android && ./gradlew :app:testDebugUnitTest :app:assembleDebug` |
| 期望结果 | BUILD SUCCESSFUL，生成 app-debug.apk |
| 自动化 | 命令本身 |

### TC-AND-002 安装并启动，显示占位页

| 字段 | 内容 |
|---|---|
| ID | TC-AND-002 |
| 标题 | 安装并启动，显示占位页 |
| 类型 | manual-device |
| 前置条件 | 设备已连接（`adb -s <serial>`），无 assets/web |
| 步骤 | `adb install -r` APK → `am start -n com.yachiyo.companion/.MainActivity` |
| 期望结果 | 全屏沉浸式（无状态栏/导航栏）显示 Native Shell fallback 页，页面日志出现 `lifecycle resume` 与 `hub.state` 事件 |
| 自动化 | manual |

### TC-AND-003 资源路径防穿越与 MIME

| 字段 | 内容 |
|---|---|
| ID | TC-AND-003 |
| 标题 | 资源路径防穿越与 MIME |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 对 `PathSafety.resolveInside` 传 `a/b.txt`、`../x`、`a/../../x`；`MimeTypes.guess` 取 mjs/wasm |
| 期望结果 | 合法路径解析成功，穿越返回 null；mjs→application/javascript，wasm→application/wasm |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/web/PathSafetyTest.kt` |

### TC-AND-004 配置默认值与递归合并

| 字段 | 内容 |
|---|---|
| ID | TC-AND-004 |
| 标题 | 配置默认值与递归合并 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 空存储 get；set 嵌套补丁；数组补丁；非法 JSON |
| 期望结果 | 默认值与 C2.3 一致；嵌套对象局部更新保留兄弟键；数组整体替换；非法 JSON 抛 IllegalArgumentException；变更触发监听并持久化 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/config/ConfigStoreTest.kt` |

### TC-AND-005 device_id 持久化

| 字段 | 内容 |
|---|---|
| ID | TC-AND-005 |
| 标题 | device_id 持久化 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 两次创建 ConfigStore 读取 deviceId |
| 期望结果 | 以 `android-` 开头且两次相同 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/config/ConfigStoreTest.kt` — `deviceIdStable` |

### TC-AND-006 Hub 握手

| 字段 | 内容 |
|---|---|
| ID | TC-AND-006 |
| 标题 | Hub 握手 |
| 类型 | unit |
| 前置条件 | MockWebServer 充当网关 |
| 步骤 | connect → 收 hello → 回 welcome |
| 期望结果 | 状态 connected；hello 含 device_id；URL 带 `token`；avatar_host 取自 welcome |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `helloWelcomeConnects` |

### TC-AND-007 令牌错误不重连

| 字段 | 内容 |
|---|---|
| ID | TC-AND-007 |
| 标题 | 令牌错误不重连 |
| 类型 | unit |
| 前置条件 | 服务端对 hello 回 close(1008) |
| 步骤 | connect |
| 期望结果 | 状态 unauthorized，不再发起新连接 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `badTokenIsUnauthorizedAndStops` |

### TC-AND-008 心跳与静默断线重连

| 字段 | 内容 |
|---|---|
| ID | TC-AND-008 |
| 标题 | 心跳与静默断线重连 |
| 类型 | unit |
| 前置条件 | welcome.heartbeat_ms 小值 |
| 步骤 | 1) 观察 ping；2) 服务端不应答 ping |
| 期望结果 | 1) 周期发送 ping；2) 约 2 个周期后主动断开并重连 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `heartbeatPingsSent`、`silentServerTriggersReconnect` |

### TC-AND-009 断线重连后恢复订阅与方法注册

| 字段 | 内容 |
|---|---|
| ID | TC-AND-009 |
| 标题 | 断线重连后恢复订阅与方法注册 |
| 类型 | unit |
| 前置条件 | 已 sub 两个主题、register 一个方法 |
| 步骤 | 服务端断开连接 |
| 期望结果 | 重连后依次收到 hello、sub（同样 topics）、rpc.register |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `subscriptionsAndRegistrationsReplayedAfterReconnect` |

### TC-AND-010 RPC 关联与超时

| 字段 | 内容 |
|---|---|
| ID | TC-AND-010 |
| 标题 | RPC 关联与超时 |
| 类型 | unit |
| 前置条件 | 已连接 |
| 步骤 | 1) 发 rpc.req 并由服务端回 rpc.res；2) 无回复；3) 未连接时调用 |
| 期望结果 | 1) 回调拿到 result，target 被透传；2) 超时返回 -32003；3) 立即返回 -32010 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `rpcRoundTripAndCorrelation`、`rpcTimeout`、`rpcWhenDisconnectedFailsFast` |

### TC-AND-011 入站 RPC：本地处理与未知方法

| 字段 | 内容 |
|---|---|
| ID | TC-AND-011 |
| 标题 | 入站 RPC：本地处理与未知方法 |
| 类型 | unit |
| 前置条件 | 已连接 |
| 步骤 | 服务端发 `device.ping`（本地注册）与未知方法 |
| 期望结果 | 本地方法返回 result；未知且无监听者返回 -32601；事件分发给监听者并更新 avatar_host |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/HubClientTest.kt` — `incomingRpcHandledLocally`、`incomingUnknownRpcWithoutListenersIsMethodNotFound`、`eventsDispatchedToListeners` |

### TC-AND-012 指数退避

| 字段 | 内容 |
|---|---|
| ID | TC-AND-012 |
| 标题 | 指数退避 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | `Backoff.delayMs(0..6)` |
| 期望结果 | 1s,2s,4s,8s,16s,30s,30s（封顶 30 s） |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/EnvelopeTest.kt` — `backoffSequence` |

### TC-AND-013 信封编解码与 Hub URL

| 字段 | 内容 |
|---|---|
| ID | TC-AND-013 |
| 标题 | 信封编解码与 Hub URL |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | Envelope 往返；非法帧；HubConfig.url |
| 期望结果 | 往返一致；非法帧返回 null；token URL 编码，ws:// 基址保留 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/hub/EnvelopeTest.kt` |

### TC-AND-014 Web 事件排队

| 字段 | 内容 |
|---|---|
| ID | TC-AND-014 |
| 标题 | Web 事件排队 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | onPageFinished 前 post 事件，之后 markReady；超过队列上限；含 U+2028 |
| 期望结果 | 按序冲刷；溢出丢最旧；脚本转义分隔符并带 `__yachiyoQueue` 兜底 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/WebDispatcherTest.kt` |

### TC-AND-015 Bridge 真机事件与调用

| 字段 | 内容 |
|---|---|
| ID | TC-AND-015 |
| 标题 | Bridge 真机事件与调用 |
| 类型 | manual-device |
| 前置条件 | fallback 页（经 handshake/invoke 调用） |
| 步骤 | 点击 deviceInfo/getConfig/hubState/vibrate/connect/disconnect |
| 期望结果 | 返回 JSON 正确（model=MI 6、sdk=35）；手机振动；页面日志出现 hub.state/config.changed/lifecycle 事件 |
| 自动化 | manual |

### TC-AND-016 返回键协议

| 字段 | 内容 |
|---|---|
| ID | TC-AND-016 |
| 标题 | 返回键协议 |
| 类型 | manual-device |
| 前置条件 | 普通模式 |
| 步骤 | 按返回键；页面不调用 consumeBack |
| 期望结果 | 300 ms 后应用退到后台（moveTaskToBack）；若页面调用 consumeBack() 则不退出 |
| 自动化 | manual |

### TC-AND-017 设备方法描述与参数校验

| 字段 | 内容 |
|---|---|
| ID | TC-AND-017 |
| 标题 | 设备方法描述与参数校验 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | `DeviceMethodSpecs.descriptors/vibrateMs/toastText/wakeMs` |
| 期望结果 | 5 个方法均 expose_as_tool；越界参数抛 -32602 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/device/DeviceMethodSpecsTest.kt` |

### TC-AND-018 设备 RPC 真机联调（假网关）

| 字段 | 内容 |
|---|---|
| ID | TC-AND-018 |
| 标题 | 设备 RPC 真机联调（假网关） |
| 类型 | manual-device |
| 前置条件 | Mac 上运行 Node+ws 假 Hub（端口 3000，host 192.168.20.212）；手机同网段 |
| 步骤 | 启动 App → 假 Hub 依次发 device.battery.get/vibrate/toast/info、vibrate(ms=99999)、model.motion.play |
| 期望结果 | 收到 hello/sub/rpc.register；电量/信息结果正确；手机振动并弹出 toast；越界返回 -32602；live2d 方法转交 Web 层 |
| 自动化 | manual |

### TC-AND-019 按住说话音频流水线

| 字段 | 内容 |
|---|---|
| ID | TC-AND-019 |
| 标题 | 按住说话音频流水线 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | begin → 6×50 ms 帧 → end(released)；cancel |
| 期望结果 | 1 个 stream：start、3 个 3200 B 块、end(released)；cancel 无块 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/audio/AudioPipelineTest.kt` — `pushToTalk*` |

### TC-AND-020 连续模式 VAD

| 字段 | 内容 |
|---|---|
| ID | TC-AND-020 |
| 标题 | 连续模式 VAD |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 静音→语音→静音(≥800 ms)→语音；短促噪声 |
| 期望结果 | 语音时开流、静音 800 ms 以 vad 结束，再次语音开新流；<150 ms 噪声以 cancel 结束；300 ms 预滚 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/audio/AudioPipelineTest.kt` — `continuous*`、`preRoll*` |

### TC-AND-021 PCM 分块与 RMS

| 字段 | 内容 |
|---|---|
| ID | TC-AND-021 |
| 标题 | PCM 分块与 RMS |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | PcmChunker 喂入非整块数据；Pcm.rms 取静音/满幅/负满幅 |
| 期望结果 | 精确 3200 B 分块且 flush 输出尾块；RMS 0/1/1 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/audio/AudioPipelineTest.kt` — `chunker*`、`rms*` |

### TC-AND-022 麦克风真机上行

| 字段 | 内容 |
|---|---|
| ID | TC-AND-022 |
| 标题 | 麦克风真机上行 |
| 类型 | manual-device |
| 前置条件 | Hub 已连接（假 Hub 即可），已授予 RECORD_AUDIO |
| 步骤 | fallback 页点 micStart，说话，点 micStop |
| 期望结果 | 状态栏出现麦克风指示；页面收到 mic.level（≈20 Hz）；Hub 端收到 audio.input.start、连续 chunk（base64，序号递增）、end(released) |
| 自动化 | manual |

### TC-AND-023 插件 manifest 校验

| 字段 | 内容 |
|---|---|
| ID | TC-AND-023 |
| 标题 | 插件 manifest 校验 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 合法/非法 manifest（id、type、entry、sdk、权限） |
| 期望结果 | 非法的全部抛 PluginException；widget 默认值与钳制正确；5 类权限格式被接受 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PluginTest.kt` — `manifest*`、`widget*`、`permissions*` |

### TC-AND-024 插件 zip 安装与路径穿越防护

| 字段 | 内容 |
|---|---|
| ID | TC-AND-024 |
| 标题 | 插件 zip 安装与路径穿越防护 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 安装合法包；含 `../../evil.txt`、绝对路径、反斜杠、缺 manifest/entry、非 zip、超限的包 |
| 期望结果 | 合法包安装并列出；恶意/损坏包全部拒绝且不遗留临时目录、不写出根目录外 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PluginTest.kt` |

### TC-AND-025 插件重装/卸载/KV 隔离

| 字段 | 内容 |
|---|---|
| ID | TC-AND-025 |
| 标题 | 插件重装/卸载/KV 隔离 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 重装同 id；两个插件各自 KV；卸载；非法 id 访问 KV |
| 期望结果 | 重装保留 KV 并替换文件；KV 彼此隔离；卸载删除代码/元数据/KV；非法 id 无效 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PluginTest.kt` |

### TC-AND-026 插件下载校验

| 字段 | 内容 |
|---|---|
| ID | TC-AND-026 |
| 标题 | 插件下载校验 |
| 类型 | unit |
| 前置条件 | MockWebServer |
| 步骤 | installFromUrl 正确 sha256 + token；错误 sha256；HTTP 404 |
| 期望结果 | 携带 `Authorization: Bearer`；sha 不符/404 报错且不安装 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PluginTest.kt` — `download*` |

### TC-AND-027 网关推送插件真机

| 字段 | 内容 |
|---|---|
| ID | TC-AND-027 |
| 标题 | 网关推送插件真机 |
| 类型 | manual-device |
| 前置条件 | 假 Hub 提供 `hello.yplug` 与 `plugin.install` 事件 |
| 步骤 | Hub 发 plugin.install（正确 sha），再发 sha 错误的一条 |
| 期望结果 | 手机下载并安装，Hub 收到 plugin.installed；错误的收到 plugin.install_failed（含 sha256 mismatch） |
| 自动化 | manual |

### TC-AND-028 背景图选择

| 字段 | 内容 |
|---|---|
| ID | TC-AND-028 |
| 标题 | 背景图选择 |
| 类型 | manual-device |
| 前置条件 | fallback 页 |
| 步骤 | 点击 pickBg 选择一张图片 |
| 期望结果 | 收到 picker.result{kind:'background', url:'https://appassets.androidplatform.net/user/backgrounds/bg-*.jpg'}；该 URL 在 WebView 中可加载 |
| 自动化 | manual |

### TC-AND-029 设为默认桌面

| 字段 | 内容 |
|---|---|
| ID | TC-AND-029 |
| 标题 | 设为默认桌面 |
| 类型 | manual-device |
| 前置条件 | — |
| 步骤 | 调 openHomeSettings 或在系统设置选 Yachiyo 为主屏幕应用；按 Home 键；在桌面按返回键 |
| 期望结果 | Home 键回到 Yachiyo；返回键不退出；getDeviceInfo().is_default_launcher=true（切回原桌面后为 false） |
| 自动化 | manual |

### TC-AND-030 应用列表与图标

| 字段 | 内容 |
|---|---|
| ID | TC-AND-030 |
| 标题 | 应用列表与图标 |
| 类型 | manual-device |
| 前置条件 | fallback 页 |
| 步骤 | 点击 apps；在 WebView 中请求列表里的 icon_url |
| 期望结果 | 返回已安装可启动应用（不含自身）含 label 与 icon_url；图标返回 PNG；非法包名返回 404；launchApp 可启动应用 |
| 自动化 | manual |

### TC-AND-031 锁屏显示人物

| 字段 | 内容 |
|---|---|
| ID | TC-AND-031 |
| 标题 | 锁屏显示人物 |
| 类型 | manual-device |
| 前置条件 | `setLockscreenEnabled(true)`；Hub 已连接 |
| 步骤 | 息屏（`input keyevent 223`）再亮屏 |
| 期望结果 | 亮屏后直接显示 LockscreenActivity（页面 URL 含 `mode=lockscreen`），Hub 收到 `sys.device.mode {mode:'lockscreen'}` |
| 自动化 | manual |

### TC-AND-032 锁屏模式插件隔离

| 字段 | 内容 |
|---|---|
| ID | TC-AND-032 |
| 标题 | 锁屏模式插件隔离 |
| 类型 | manual-device |
| 前置条件 | 处于锁屏模式 |
| 步骤 | 在锁屏页调用 listPlugins、hubSubscribe(['plugin.x.**'])、pickPluginPackage；请求 `/plugins/<id>/index.html`；网关推送 plugin.install |
| 期望结果 | listPlugins 为 []；plugin.* 订阅被忽略；选择器返回错误；/plugins/ 返回 403；plugin.install 回 plugin.install_failed |
| 自动化 | manual |

### TC-AND-033 屏幕方向不重建

| 字段 | 内容 |
|---|---|
| ID | TC-AND-033 |
| 标题 | 屏幕方向不重建 |
| 类型 | manual-device |
| 前置条件 | fallback 页 |
| 步骤 | 点 landscape，再点 auto |
| 期望结果 | 屏幕立即切为横屏（1920×1080 截图），页面状态/日志保留（Activity 未重建）；auto 恢复自动旋转 |
| 自动化 | manual |

### TC-AND-034 锁屏解锁与返回

| 字段 | 内容 |
|---|---|
| ID | TC-AND-034 |
| 标题 | 锁屏解锁与返回 |
| 类型 | manual-device |
| 前置条件 | 锁屏人物显示中（无安全锁） |
| 步骤 | 按返回键；或解锁 |
| 期望结果 | 返回键触发 requestDismissKeyguard 后 Activity 结束；ROM 未回调时 750 ms 后关闭人物覆盖页且系统认证仍保留；Hub 收到 mode=normal；解锁（USER_PRESENT）也会结束 |
| 自动化 | manual |

### TC-AND-035 包名与图标路径校验

| 字段 | 内容 |
|---|---|
| ID | TC-AND-035 |
| 标题 | 包名与图标路径校验 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | `PackageNames.isValid/fromIconPath` |
| 期望结果 | 合法包名通过；`nodots`、`../x.y`、含 `/` 被拒；图标路径需 .png |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/launcher/PackageNamesTest.kt` |

### TC-AND-036 handshake 仅首次返回令牌

| 字段 | 内容 |
|---|---|
| ID | TC-AND-036 |
| 标题 | handshake 仅首次返回令牌 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 连续调用 handshake() |
| 期望结果 | 首次返回 64 位 hex；之后返回空串并告警 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/BridgeGateTest.kt` — `handshakeOnlyFirstCallReturnsToken` |

### TC-AND-037 页面重载重置令牌并使旧令牌失效

| 字段 | 内容 |
|---|---|
| ID | TC-AND-037 |
| 标题 | 页面重载重置令牌并使旧令牌失效 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | handshake → reset → 用旧令牌 invoke → 再 handshake |
| 期望结果 | 旧令牌 -32006；新令牌不同且可用 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/BridgeGateTest.kt` — `resetIssuesFreshTokenAndInvalidatesOld` |

### TC-AND-038 令牌不匹配/未握手被拒

| 字段 | 内容 |
|---|---|
| ID | TC-AND-038 |
| 标题 | 令牌不匹配/未握手被拒 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | 握手前、错误令牌、空令牌调用 invoke |
| 期望结果 | 均返回 -32006 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/BridgeGateTest.kt` — `mismatchAndNoHandshakeRejected` |

### TC-AND-039 按名称分派与错误码

| 字段 | 内容 |
|---|---|
| ID | TC-AND-039 |
| 标题 | 按名称分派与错误码 |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | invoke 已知方法、未知方法、非法参数、处理器抛异常 |
| 期望结果 | 结果透传；-32601；-32602；-32603 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/bridge/BridgeGateTest.kt` — `dispatchByNameWithArgsAndErrors` |

### TC-AND-040 沙箱 iframe 无法获得可用令牌（真机）

| 字段 | 内容 |
|---|---|
| ID | TC-AND-040 |
| 标题 | 沙箱 iframe 无法获得可用令牌（真机） |
| 类型 | manual-device |
| 前置条件 | fallback 页（内置沙箱 iframe 探针） |
| 步骤 | 安装并启动 App；`adb logcat | grep -E 'BridgeGate|IFRAME_PROBE'`；点击 deviceInfo/hubState |
| 期望结果 | 宿主页按钮正常（token=ok）；logcat 出现 `handshake called again; refused`；`IFRAME_PROBE` 中 handshake 为空串，invoke 返回 -32006 |
| 自动化 | manual（MI 6 已验证） |

### TC-AND-041 仅信任 gateway/runtime 发出的 plugin.install

| 字段 | 内容 |
|---|---|
| ID | TC-AND-041 |
| 标题 | 仅信任 gateway/runtime 发出的 plugin.install |
| 类型 | unit |
| 前置条件 | — |
| 步骤 | PushPolicy.trustedSender 传 gateway/runtime/设备 id/空串/插件名 |
| 期望结果 | 仅 gateway、runtime 为真；其他事件被忽略并记录 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PushPolicyTest.kt` — `onlyGatewayOrRuntimeTrusted` |

### TC-AND-042 推送 URL 外部主机被拒（不泄露令牌）

| 字段 | 内容 |
|---|---|
| ID | TC-AND-042 |
| 标题 | 推送 URL 外部主机被拒（不泄露令牌） |
| 类型 | unit |
| 前置条件 | 配置服务器 10.0.0.5:3000 |
| 步骤 | resolveUrl 传相对路径、同源绝对 URL、其他主机/端口/协议、`//evil.com`、子域欺骗、userinfo 欺骗 |
| 期望结果 | 相对与同源通过；其余全部 PluginException(`foreign_url`)，对应回执 `plugin.install_failed{reason:"foreign_url"}` |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/plugins/PushPolicyTest.kt` — `relativeResolvesAgainstServer`、`sameServerAbsoluteAccepted`、`foreignAbsoluteRejected` |

### TC-AND-043 推送缺少 sha256 被拒

| 字段 | 内容 |
|---|---|
| ID | TC-AND-043 |
| 标题 | 推送缺少 sha256 被拒 |
| 类型 | manual-device |
| 前置条件 | 假 Hub |
| 步骤 | 发送不带 sha256 的 plugin.install |
| 期望结果 | Hub 收到 plugin.install_failed（error `sha256 required`），不发起下载 |
| 自动化 | manual |

### TC-AND-050 多 WebView RPC 只由一个宿主应答

| 字段 | 内容 |
|---|---|
| ID | TC-AND-050 |
| 标题 | Settings 不抢答且首个活动渲染宿主独占 RPC |
| 类型 | integration |
| 前置条件 | HubClient 同时注册设置页、主页面、重复页面监听者 |
| 步骤 | 服务端发送 `rpc.req state.get` |
| 期望结果 | Settings 返回未接管；主页面应答一次；其后监听者不被调用；所有监听者未接管时统一回 -32601 |
| 自动化 | `HubClientTest.kt` — `incomingRpcIsDeliveredOnlyToTheFirstClaimingSurface`、`unclaimedRpcWithListenersReturnsMethodNotFound` |

### TC-AND-051 锁屏与普通页面事件隔离

| 字段 | 内容 |
|---|---|
| ID | TC-AND-051 |
| 标题 | currentMode 只允许对应渲染宿主接收 Hub payload |
| 类型 | unit |
| 前置条件 | normal/lockscreen/settings 三种 surface |
| 步骤 | 组合 surfaceMode、currentMode、isSettings |
| 期望结果 | normal-normal 与 lockscreen-lockscreen 接受；Settings 和 mode 不匹配全部拒绝 |
| 自动化 | `HubSurfacePolicyTest.kt` — `onlyTheCurrentRenderSurfaceAcceptsPayloads` |

### TC-AND-052 锁屏语音、动作与插件真机隔离

| 字段 | 内容 |
|---|---|
| ID | TC-AND-052 |
| 标题 | Main 与 Lockscreen 不双播放、不双应答 |
| 类型 | manual-device |
| 前置条件 | Main 已加载插件且设备连接真实网关 |
| 步骤 | 开启锁屏并息屏；网关发 voice.play、live2d RPC、调用插件工具；再解锁重复 |
| 期望结果 | 锁屏时只有 Lockscreen 播放/应答，插件工具不可用；解锁后只有 Main 播放/应答且插件重新可用 |
| 自动化 | manual（待真机） |
