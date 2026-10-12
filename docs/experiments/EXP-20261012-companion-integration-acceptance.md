# Android Companion 集成与真机验收

> 类型: experiment
> 状态: active
> 负责人: codex-coordinator
> 更新: 2026-10-13
> 关联: ../testing/TC-android-companion-integration.md, ../plans/PLAN-android-companion.md

## 背景与假设

前一轮工作流分别通过单测，但 WS3 与 WS5 尚未合并。假设将 pi、Device Hub、Android 原生和 Web 前端集成后，可以完成真实配对、人物呈现、插件安装与工具调用。用户进一步要求配置页局域网发现和小米 6 达到 60 FPS，必须分别验证。

## 实验环境

- 统筹分支 `feature/android-companion`，首次集成 WS3 `84c2924`、WS5 `0eaf75c`。
- 小米 6，Wi-Fi ADB `192.168.20.183:5555`，严格使用共享设备锁。
- 电脑独立测试网关端口 3002，隔离运行目录 `/tmp/yachiyo-companion-acceptance`；2026-10-13 载入隔离的真实 LLM/TTS 配置并发布 C7 mDNS 服务 `Yachiyo Acceptance Mac`。
- Node 24.10.0；JDK 17.0.16；模型 yachiyo-kaguya，初始质量 4096。

## 方法

1. 合并各工作流，运行完整 Node 测试和 Android 单测/assembleDebug。
2. 安装包含生成资源的 APK，连接真实网关；通过 HTTP 触发 avatar transfer，并在 WebView/CDP 和截图中交叉检查显示状态。
3. 真机方向切换和滑动；电脑推送示例 `.yplug`；通过配对 WebSocket 调用示例插件工具。
4. 性能基线：横屏稳定后连续 5 秒采集 rAF 间隔；暂时包装 stage.render 测量同步耗时，结束立即恢复原函数。记录真实帧数与渲染分辨率，不修改渲染循环。
5. 在修复分支上复测发现、会话/插件/音频链路和帧率；通过实际 DocumentsUI 选择器验收背景和 `.yplug` 导入。

## 数据与观察

| 检查 | 结果 |
|---|---|
| WS3 合并全量 Node | 588/588 通过 |
| WS5 合并全量 Node | 隔离 HOME/TMP 后 624/624 通过；首次运行一个 legacy 网关启动超过 7 秒，重跑通过 |
| Android 集成构建 | `:app:testDebugUnitTest :app:assembleDebug` 成功，完整资源 APK 安装成功 |
| 初始旧配置 | 手机仍连接前轮 3001 mock，模型隐藏；切至真实 3002 并移交 host 后正常出现 |
| 竖屏/横屏/滑动 | 全身、上半身、左侧人物/右侧插件、右侧人物/左侧组件均可见 |
| 真实手机 RPC | state.get 返回 modelLoaded=true、visible=true、quality=4096、is_host=true；横屏/面板字段与画面一致 |
| 插件推送 | pomodoro 与 clock-widget 均实际安装，时钟正常呈现 |
| 插件远程工具 | plugin.com.yachiyo.pomodoro.start_timer({minutes:1}) 返回 `{ok:true,minutes:1}` |
| C7 局域网发现 | 真机显示 `Yachiyo Acceptance Mac`、`192.168.20.212:3002`；选择不同 endpoint 后旧 token 清空并提示重新配对；服务丢失移除与 multicast lock 释放未直接测量 |
| 设置模型响应 | 实网关返回 `{ok,data}` 时暴露 `models.enabled.map` 崩溃；`fcc7a75` 增加响应归一化后，模型选项与发现候选同时正常渲染 |
| 默认 Launcher | HOME role 切到 `com.yachiyo.companion` 后 Home 键进入 MainActivity；验收后恢复 `com.android.launcher3` |
| 单宿主与锁屏插件隔离 | 锁屏时 `hub.rpc.request` 计数 Lockscreen=1、Main=0，`state.get` 成功；`listPlugins()` 为空、iframe 为 0、插件 RPC 返回 -32006；voice.play 单播未在本窗口复测 |
| 锁屏退出 | 部分 ROM 不回调 `requestDismissKeyguard`；`633b97c` 增加安全 fallback 后，调用退出 2 秒内 Activity 销毁且 Hub mode 回到 `normal` |
| 背景导入 | DocumentsUI 选择 PNG 后复制到 `/user/backgrounds/` URL 并持久化 |
| 手动插件导入 | DocumentsUI 选择 `pomodoro.yplug` 后覆盖安装成功，插件启用且 `installed_at` 更新 |
| 桌面往返 | 统筹者报告真实 Electron desktop 与手机经 `/api/device/avatar/transfer` 往返通过 |
| 图形与温度诊断 | WebGL vendor `Qualcomm`、renderer `Adreno (TM) 540`，确认硬件渲染；Android 15 / WebView Chrome 153.0.8010.36；电池温度 40.0°C；thermalservice 未给出可读当前状态 |

初始横屏性能（CSS 640×360、DPR 3、renderer resolution 2）：

| 指标 | 基线 |
|---|---:|
| 约 5 秒渲染帧数 | 102 |
| 实测 FPS | 20.34 |
| 帧间隔平均 / p50 / p95 | 49.17 / 49.70 / 99.50 ms |
| stage.render 同步耗时平均 / p95 | 41.63 / 48.70 ms |

后续集成回归：pi 工具编码、动态设备授权、Hub 鉴权/去重/音频元数据、Android 发现/单宿主路由与 NSD 清理、mDNS 广播汇合后，完整 Node **642/642** 通过，Android 单测与 assembleDebug 通过。修复设置响应与锁屏退出后完整 Node **644/644** 通过，Android 单测与 assembleDebug 再次通过。TC-COMP-001 已验证真实 pi SDK 经完整网关调用配对设备插件，工具结果进入第二次模型请求，消息不重复且会话持久化。

## 结论与决策

局域网发现、设置、Launcher、锁屏 RPC 与插件隔离、背景和手动插件导入已经在真机串通。锁屏语音单播、服务丢失与 multicast lock 释放仍需专项覆盖，不能据此宣称全部目标完成。模型渲染优化版约 22.56 FPS，仍远低于 60 FPS，性能是当前阻塞项；继续分解模型更新和绘制耗时，优化后按相同方法复测。

集成审查还发现 pi 双事件导致手机 delta 重复，以及多个 WebView 竞争设备 RPC 的风险，分别由网关与 Android 工作流修复，并增加集成回归。

## 后续动作

- 性能专项优化并实测 TC-COMP-005；保留质量取舍和未达标场景。
- 完成 TTS 口型、麦克风录制和锁屏 voice.play 单播验收；未执行项保持明确标注。
- 补测 C7 服务丢失移除、不可用网络错误与 multicast lock 生命周期。

### 音频设备兼容性诊断（2026-10-13）

真实 pi 语音调用成功，TTS 返回音频且 Android 报告 started，但默认 AudioContext 随即 suspended，currentTime 停在约 0.02 秒，口型最大开度为 0。logcat 显示 AAudio/MMAP 输出 `mHalStream->start() = -61`、`requestStart_l() error = -889`，属于此 Android 15 ROM 的低延迟输出路径问题。收到 started/ended 并不等于音频真实连续播放，第一轮不算通过。

同一手机显式 `new AudioContext({latencyHint:'playback'})` 的短测试在 1 秒后为 running/currentTime=1.0667，提供可验证的兼容方案；播放器正在落实后复验。麦克风原生录音开始/取消已执行，尚未据此声明识别/回复链路完成。

手机唤醒需等待系统画面完成；`input keyevent 224` 后约 1 秒，再 `wm dismiss-keyguard` 与上滑，才恢复 Main 可见。该状态下确认手机 host 人物返回、modelLoaded=true、visible=true、paused=false。所有临时旋转、锁屏开关和 screen_off_timeout（原 1800000）均已恢复并释放设备锁。

### 稳定基线音频复验与性能回退

- `c96dc4b`（不含性能实验）Node 653/653、Android 单测/构建通过。真机 TTS playback started→ended 为 2407 ms；AudioContext 保持 running，currentTime 推进至10.005秒；口型43个采样处于active、最大开度0.935，播放与口型通过。
- 真实麦克风录音3.45秒，RMS峰值0.158，recording→uploading→idle，16kHz单声道WAV产生；该次外部扬声器测试ASR结果为空，故不宣称实录识别通过。读取系统音量发现MUSIC speaker为0，未擅自保留音量修改。
- 后续真实模型调用返回 `Arrearage`（服务账户欠费），已停止真实API重试，离线测试不受影响。声音服务之前成功和之后账户阻断分别记录。
- 用户报告性能实验版人物持续抽动。立即回退主线稳定APK，人物恢复完整显示；性能实验不合并。确认缺陷：原库每帧 saveParameters→physics→Core→loadParameters，简单跳过physics会导致输出与基础姿态交替。后续候选先恢复逐帧physics，并在隔离分支审查顶点插值/GL缓冲合并。
- 有问题的compositor实验虽然idle rAF57.99、swipe55.49，但真实draw/Worker约17Hz且画面抽动，绝不视作60FPS达标。A15继续阻塞。

### 插值绘制候选 827f036 的独立复测（2026-10-13）

在设备锁 `coordinator-perf` 内安装隔离候选，未合并主线；未调用模型或音频服务。模型恢复逐帧 physics、每个 rAF 实际执行 WebGL draw，Core 在 Worker 求值，帧间顶点和透明度插值。

| 场景 | 时长 | 实际绘制帧数 / FPS | 帧间隔均值 / p95 | draw 耗时均值 / p95 | Worker Hz |
|---|---:|---:|---:|---:|---:|
| 竖屏待机 | 10.001 s | 556 / 55.59 | 18.12 / 21.50 ms | 16.57 / 20.00 ms | 18.50 |
| 横屏连续左右滑动 | 10.484 s | 569 / 54.27 | 18.44 / 23.10 ms | 16.26 / 20.40 ms | 17.93 |

本次 draw 数与 rAF 一致，区别于此前只移动缓存画布的失败实验；但 Core 原始求值频率仍低于显示帧率，必须如实区分。截图确认人物完整、横屏分屏布局正确；静态截图不能证明动态无抽动，因此尚未验收动作连续性。每帧约400次 draw call、59次 program change，后续优先减少重复 GL 状态设置。

原始数据保留在本机 `/tmp/yachiyo-companion-acceptance/perf-827f036-idle.json` 与 `perf-827f036-swipe.json`。结束后重新安装稳定 `c96dc4b` APK并启动 MainActivity，恢复自动旋转1/user_rotation0、释放锁。候选未达到60FPS，不合并为正式修复。

### 背景素材选择

已找到并视觉确认[影片官网角色背景](https://www.cho-kaguyahime.com/assets/img/character/character_bg.jpg)（2400×1440）：蓝紫水面、朱红宫殿、暖色灯光，没有其他人物，适合叠加八千代。已向用户展示原图及官网来源；本轮只提供候选，未将第三方素材打包入仓库或修改手机背景。

### GL 状态缓存与 FPS 计时审查（2026-10-13）

候选 `02cf3f6` 增加逐 drawModel 的 GL 状态缓存，独立审查确认 texture 按 unit/target、uniform 按 location/value 区分，每 pass 清缓存并恢复原方法。首次 host 时钟结果为59.29FPS，但采样发现 CDP begin/snapshot 排队导致页面实际采样时长超过 host 等待时间，不能拿该数字声明60FPS。已由 `f93fbfd` 改成页面同一 performance.now 时钟计算。

当前APK通过页面内 Promise 同时包围 begin/snapshot 的暖机复测：10.0247秒561帧，实际draw **55.96FPS**，draw均值16.34ms/p95 20.30ms，Worker18.06Hz。缓存跳过2,508,026次重复状态调用，仍未达标。8秒Greet/Idle录屏及4Hz连续抽帧未见明显撕裂，但低频抽帧不能证明逐帧稳定；文件位于本机 `/tmp/yachiyo-companion-acceptance/perf-02cf3f6-greet.mp4`。候选未合并，真机再次恢复稳定音频APK。下一步交错position/UV VBO降低buffer绑定次数。

### 通用节省计划购买后复验

用户明确告知已购买入门型AI通用节省计划并要求重试。2026-10-13通过现有`qwen35_plus/qwen3.5-flash`配置执行一次最小连接测试，HTTP200，1363ms，无Arrearage。随后真实pi工具调用到手机TTS播放2325ms，完整started/ended通过，日志 `mobile-voice-after-savings.log`。成功仅说明调用恢复；没有访问账单，不能据此断言抵扣项或剩余额度。

该产品沿用通用API凭据，和限制应用后端使用的Token Plan不同，见[官方节省计划使用方式](https://help.aliyun.com/zh/model-studio/savings-plan-and-resource-package)。原文档关于“只换Coding Plan Base URL即可”的误导表述已纠正。

手机自播放参考语音并用原生MIC回录时，曾尝试通过系统命令把媒体音量从0/25设为5；后续复核发现该命令静默返回但没有生效，真实读回始终为0。录音RMS最大0.208来自低频瞬态，WAV没有参考语音的谐波结构；服务返回Empty ASR transcript。该次实验不能用于判断同机回声抑制或声学路径，详见[Android 麦克风回录与扬声器试听验收](EXP-20261013-android-microphone-acoustic-capture.md)。

随后用户用实体音量键把系统媒体音量调到17/25（68%），应用音量1，播放`voice/qwen-tts-real.wav`（“这是八千代手机语音测试。”）；`voice.playback.ended`完成，用户明确反馈“能听清，音量正常”。物理扬声器输出通过，但此次未同步录音，真实讲话ASR→回复仍未通过。
