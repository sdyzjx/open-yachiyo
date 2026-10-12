# Android Live2D 静音口型复位实验

> 类型: experiment
> 状态: done
> 负责人: render-acceptance
> 更新: 2026-10-13
> 关联: docs/features/FEAT-android-live2d-stage.md, docs/testing/TC-android-web.md#tc-awb-028-口型结束中性复位, test/android-web/lipsync.test.js, test/android-web/stageMouth.test.js

## 背景与假设

用户报告手机人物在没有语音时持续张嘴且嘴形异常。Cubism Core 从 `model.moc3` 读取的 `ParamMouthOpenY` 和 `ParamMouthForm` 默认值均为 `0`，但 2048/4096 资源中的 Idle、Greet、ReactError motion 会在每次模型更新写入 `OpenY=0`、`Form=1`。因此只在语音结束时复位一次仍会被下一次 motion 更新覆盖。

假设是在每次真实 `beforeModelUpdate` 中先恢复 MOC 口型默认值，并保留显式参数 overlay 和活跃语音口型的更高优先级，可以消除静音怪嘴，同时不损害正常口型。

## 实验环境

- 设备：小米 6 真机，4096 模型资源；本轮使用用户明确授权的 USB 调试，命令始终指定单台 USB 设备。
- 版本：`ecdfb6b`，基于已集成 Android UI 的 `5969e93`。
- APK SHA-256：`72534098c5db74be7ec7299a040ef0e774ebc623cdfc6c896cc7abcbc2a66532`。
- 音频：仓库本地参考音频 `assets/reference/yachiyo_voice_ref_clone_18s.mp3`，没有调用外部 TTS 或付费模型。
- 设备状态：媒体音量 17/25；测试结束恢复自动旋转 `1`、用户旋转 `0` 并释放设备锁。

## 方法

1. 在舞台自己的 override hook 之后注册只读 `beforeModelUpdate` 采样器，从实际提交给 Cubism 的口型参数取样。
2. 静音 Idle 保持 15 秒，统计每次真实模型更新的 `OpenY`、`Form` 和 `mouth.active`。
3. 播放 18 秒本地参考音频，记录播放中的参数范围并截图检查嘴形。
4. 等待自然播放结束，再统计连续 3 秒的真实模型更新。
5. 自动化测试另行模拟 motion 在连续三次更新前反复写入 `Form=1`，并覆盖静音、overlay、活跃语音和 release 后连续复位。真机本轮没有单独触发 Greet/ReactError；它们与 Idle 的恒定嘴曲线以及不分 motion 类型的复位路径由资源审计和自动化覆盖。

## 数据与观察

| 状态 | 真实更新样本 | OpenY | Form | 活跃口型样本 | 观察 |
|---|---:|---:|---:|---:|---|
| 静音 Idle 15 秒 | 466 | 全程 0 | 全程 0 | 0 | 嘴部闭合且保持自然中性 |
| 本地参考音频播放中 | 213（截面） | 0–0.9976 | -0.6899–0.0311 | 194 | 嘴形随音频自然张合，没有静音默认层压住语音 |
| 自然结束后连续 3 秒 | 94 | 全程 0 | 全程 0 | 0 | `voiceSpeaking=false`，持续回到中性 |

截图：`/tmp/mouth-fix-idle-15s.png`、`/tmp/mouth-fix-playing.png`、`/tmp/mouth-fix-after.png`（验收主机临时证据，不进入仓库）。

构建与自动化：`npm run test:ci` 667/667 通过；`./gradlew :app:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL（41 tasks）。

## 结论与决策

三状态通过。静音中性层必须在每次真实模型更新执行，优先级固定为 motion < MOC 中性默认值 < action/RPC overlay < 活跃语音。一次性 release 复位不能解决 motion 下一帧重新写入的问题。

本结论只覆盖嘴形异常。人物身体抽动和 Live2D 60 FPS 仍由独立性能实验验收，不能由本实验判定通过。

## 后续动作

- 将 `ecdfb6b` 独立合入 Android 主分支并复跑合并后测试。
- 后续真机动作回归补充显式 Greet/ReactError 切换；若资源曲线改变，继续以 MOC 默认值和 overlay 优先级为准。
- 在设备降温、充电稳定后继续 page-clock、真实 draw 和人物连续性验收。
