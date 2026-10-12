# 真实 pi、TTS 与 ASR 服务验收

> 类型: experiment
> 状态: done
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-13
> 关联: ../features/FEAT-device-hub-bus.md, ../testing/TC-device-hub-bus.md, ../../apps/desktop-live2d/main/voice/qwenTtsClient.js, ../../apps/gateway/deviceHub/asrService.js

## 背景与假设

Android Companion 的服务器侧闭环同时依赖真实 pi 模型调用、DashScope TTS 和 ASR。自动化测试使用 mock，不能证明外部服务、实际凭据、音频编码和本地实现能够共同工作。

本实验验证三个假设：真实 pi 可以通过已配置的 `qwen35_plus` 返回非空答复；`QwenTtsClient` 可以生成可解码的短音频；同一音频可由 `createAsrService` 经 Qwen ASR 还原文本。手机播放、口型和麦克风采集不在本实验范围。

## 实验环境

- 日期：2026-10-13
- 系统：Darwin 25.2.0 arm64
- Node.js：v24.10.0
- ffmpeg：8.0.1
- 隔离运行目录：`/tmp/yachiyo-companion-acceptance`
- Provider 域名：`https://dashscope.aliyuncs.com`
- 凭据来自隔离配置副本；过程不打印、不记录 API key，也不修改原 `~/yachiyo/config/`
- 测试文本：`这是八千代手机语音测试。`

接口与模型能力核对以下官方资料：

- [非实时语音合成](https://www.alibabacloud.com/help/tc/model-studio/non-realtime-tts-user-guide)
- [非实时语音合成（Qwen-TTS）API 参考](https://www.alibabacloud.com/help/tc/model-studio/qwen-tts-api)
- [Qwen-ASR API 参考](https://www.alibabacloud.com/help/tc/model-studio/qwen-asr-api-reference)

## 方法

1. 使用隔离 HOME 中的 `qwen35_plus` 配置发起一次真实 pi 网络请求，记录从请求到非空最终答复的墙钟时间。
2. 使用 `QwenTtsClient.synthesizeNonStreaming()` 调用官方 HTTP TTS 接口。先验证配置模型，再验证官方快照模型；两者不可见后，以同域名、同凭据调用同系列 `qwen3-tts-flash`。
3. 下载返回的短音频到权限为 `0600` 的私有临时目录，用 `ffprobe` 检查容器、采样率、声道、时长和大小。
4. 仅在隔离 `providers.yaml` 增加 `asr_dashscope`，复用现有 DashScope 域名和凭据，模型为 `qwen3-asr-flash`。仓库当前按 provider 类型发现 ASR，不存在单独的 ASR 引用字段。
5. 用 ffmpeg 把合成音频转换为 16 kHz、单声道、PCM 16-bit WAV，再把 Buffer 直接交给 `createAsrService()`；不发送用户录音，不触发 `voice.requested` 或任何设备事件。
6. 验收后把隔离 `qwen3_tts.tts_model` 调整为已验证可用的 `qwen3-tts-flash` 并保留备份。客户端每次合成时读取 provider 配置，不需要重启服务。

## 数据与观察

| 项目 | 模型 | 结果 | 观察 |
|---|---|---|---|
| pi 真实联网 | `qwen35_plus/qwen3.5-flash` | 成功 | 返回非空最终答复，单次观测约 1,999 ms |
| TTS 配置模型 | `qwen3-tts-instruct-flash` | 失败 | HTTP 404，`InvalidParameter: Model not exist` |
| TTS 官方快照 | `qwen3-tts-instruct-flash-2026-01-26` | 失败 | HTTP 404，`InvalidParameter: Model not exist` |
| TTS 同系列基础模型 | `qwen3-tts-flash` | 成功 | WAV、PCM s16le、24 kHz、单声道、2.56 秒、122,924 bytes |
| ASR | `qwen3-asr-flash` | 成功 | 16 kHz 单声道 WAV 输入；输出 `这是八千代手机语音测试。`，与原文完全一致 |

pi 的约 1,999 ms、TTS 和 ASR 单次时延仅用于确认链路可用，不构成性能基准。TTS 失败响应说明请求已经到达官方域名且接口路径有效，限制发生在当前凭据对模型的可见性或地域授权，而不是本地 mock 或音频下载阶段。

## 结论与决策

真实 pi、TTS 和 ASR 的服务器侧能力均已得到外部服务响应验证。`qwen3-tts-flash` 与 `qwen3-asr-flash` 在当前 DashScope 域名和凭据下能够完成文本到音频再回到相同文本的闭环。

当前凭据无法使用 `qwen3-tts-instruct-flash` 及其快照，因此隔离验收配置使用 `qwen3-tts-flash`。运行时必须让未显式指定模型的 `voice.requested` 由 `QwenTtsClient` 读取 provider 默认值，不能注入历史硬编码 VC 模型。

## 后续动作

- TC-HUB-016 的播放阶段已后续完成：稳定基线口型最大开度0.935；用户在系统媒体音量17/25（68%）、应用音量1下试听同一参考 WAV，确认“能听清，音量正常”，且`voice.playback.ended`完成。
- 手机麦克风已生成16 kHz单声道WAV，但先前同机回录时系统媒体音量实际仍为0，文件中没有语音频谱；真实讲话ASR→pi回复仍需真机验收，详见[Android 麦克风回录与扬声器试听验收](EXP-20261013-android-microphone-acoustic-capture.md)。
- 如需恢复 Instruct 能力，应在阿里云控制台确认 API key 的地域和模型授权；不要通过更换未知域名或第三方服务规避限制。
