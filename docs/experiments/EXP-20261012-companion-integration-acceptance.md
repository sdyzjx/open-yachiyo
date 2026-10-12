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
