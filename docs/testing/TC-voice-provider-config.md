# 语音 Provider 配置测试用例

> 类型: testcase
> 状态: active
> 负责人: agent/v2-voice-providers
> 更新: 2026-10-13
> 关联: docs/features/FEAT-voice-provider-config.md

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-VOC-001 | 无 voice 段的配置保持有效 | unit | 仅 chat+tts+asr providers | validateConfig；loadModelCatalog | 通过；tts/asr 取第一个对应类型 | test/runtime/config/voiceConfigSchema.test.js |
| TC-VOC-002 | tts_openai_compatible 校验 | unit | 缺 tts_voice / 非法 format / 缺 base_url | validateConfig | 抛出明确错误 | 同上 |
| TC-VOC-003 | voice.active_* 选择与校验错误 | unit | voice 引用不存在/错类型 provider | validateConfig；loadModelCatalog | 选中指定 provider；错误信息指出字段 | 同上 |
| TC-VOC-004 | TTS 解析顺序 | unit | 设置 TTS_PROVIDER_KEY | loadModelCatalog | active_tts > env > 第一个；无效 env 被忽略 | 同上 |
| TC-VOC-005 | ASR model 兼容 asr_model | unit | ASR provider 仅有 asr_model | normalize / catalog | model 取 asr_model；两者都缺则报错 | 同上 |
| TC-VOC-006 | 旧 qwen3_tts key 兼容 | unit | 无 voice 段、TTS_PROVIDER_KEY=qwen3_tts | loadModelCatalog | 解析到 qwen3_tts | test/runtime/config/voiceConfigSchema.test.js |
| TC-VOC-010 | tts_dashscope 合成（URL + 下载） | integration | 本地 mock HTTP | createTtsClient().synthesize | 请求体/鉴权头正确；返回 buffer+mime；supportsRealtime=true | test/runtime/voice/voiceProviders.test.js |
| TC-VOC-011 | 无实时模型不支持实时；HTTP 错误映射 | integration | mock 返回 401 | synthesize | supportsRealtime=false；TTS_PROVIDER_AUTH_FAILED | 同上 |
| TC-VOC-012 | tts_openai_compatible 合成 | integration | mock /v1/audio/speech | synthesize | POST 体含 model/voice/input/response_format；mime 取自响应头 | 同上 |
| TC-VOC-013 | 选择、显式 key 与缺配置错误 | unit | 多 provider | createTtsClient | 按 voice.active_tts；显式 providerKey 覆盖；缺配置抛 TTS_CONFIG_MISSING | 同上 |
| TC-VOC-014 | asr_openai_compatible 转写 | integration | mock /v1/audio/transcriptions | transcribe | multipart 含 wav/model/language | 同上 |
| TC-VOC-015 | asr_dashscope 内联音频与 asr_model 兼容 | unit | 注入 fetchImpl | transcribe | 使用 compatible-mode；空文本 ASR_EMPTY；HTTP 错误 ASR_HTTP_ERROR | 同上 |
| TC-VOC-016 | describeVoiceConfig 无密钥 | unit | provider 含 api_key/headers | describeVoiceConfig | JSON 不含任何密钥；has_api_key 布尔 | 同上 |
| TC-VOC-020 | 手机播放 voiceRelay 按当前 provider 合成 | integration | PROVIDER_CONFIG_PATH 指向 tts_openai_compatible + mock 服务 | voiceRelay.handle | 手机收到 voice.play，音频来自 /v1/audio/speech | test/gateway/deviceHub/voiceRelay.test.js |
| TC-VOC-021 | 桌面包装器对无远程 URL 的 provider 返回 data URL | unit | active_tts=tts_openai_compatible | QwenTtsClient.synthesizeNonStreaming / fetchAudioBuffer | audioUrl 为 data:；fetchAudioBuffer 解码；supportsRealtime=false | test/desktop-live2d/qwenTtsClient.test.js |
| TC-VOC-022 | 实时 TTS 仅在 provider 支持时可用 | unit | 切换 voice.active_tts | 读取 realtime client 的 streamSynthesis | dashscope+实时模型为函数；其他为 undefined（桌面回退非流式） | test/desktop-live2d/qwenTtsRealtimeClient.test.js |
| TC-VOC-023 | asrService 遵循 voice.active_asr | unit | 两个 ASR provider | loadAsrProvider | 返回 active_asr 指定项，model 兼容 asr_model | test/gateway/deviceHub/audioInput.test.js |
| TC-VOC-024 | Qwen3.8 Omni 整段音频直通 | integration | 选择 `qwen3.8-omni-flash` | 手机上传 PCM 并结束录音 | WAV 以内联 `input_audio` 送给所选模型；不调用独立 ASR；转出的用户文本携同一 `model_ref` 进入 Agent | `test/gateway/deviceHub/audioInput.test.js`, `test/gateway/deviceHub/omniAudio.test.js` |
| TC-VOC-025 | Qwen3.8 Omni Realtime 工作区通道 | integration | 工作区专属 URL 与假 WebSocket | 校验 URL；执行输入转写与 Pi provider 输出 | 公开域名被拒绝；PCM 输入和 24 kHz PCM 输出使用工作区专属通道 | `test/gateway/deviceHub/omniAudio.test.js`, `test/runtime/agent-pi/qwenRealtimeAdapter.test.js` |
| TC-VOC-026 | Realtime 配置错误可诊断且不可误选 | integration | Realtime 模型使用公共 DashScope URL 或非法 WebSocket URL | 读取手机模型目录；启动音频；从配置页保存 | 模型标为不可用且选择器禁用；启动错误保留 `-32602` 与工作空间提示；配置页拒绝保存 | `test/gateway/deviceHub/modelControl.test.js`, `test/gateway/deviceHub/audioInput.test.js`, `test/gateway/configSecurity.test.js`, `test/android-web/modelPicker.test.js` |
| TC-VOC-027 | Realtime 原生音频与 Pi 输出独立 | integration | 假 WebSocket、Pi tool call、Yachiyo 测试音色 | 注入 function call、文字 delta 与 audio delta | 工具由 Pi 执行；文字、工具事件和克隆音频为独立通道；tool result 随下一次 Pi 请求回放 | `test/runtime/agent-pi/qwenRealtimeAdapter.test.js`, `test/runtime/agent-pi/piRuntime.test.js` |
| TC-VOC-028 | 工作空间 Realtime 真实复刻语音与工具往返 | manual-device | 阿里云 CLI 已登录且模型推理权限开启；已为目标模型创建 Yachiyo 音色 | 发送“调用时间工具”的 16 kHz PCM；执行本地测试工具并回传结果；检查 24 kHz 输出；重启手机 App 检查在线状态 | 云端调用工具并根据结果续答；返回中文文本与非空复刻音频；不调用独立 TTS；手机显示 Realtime 型号、人物和电脑在线 | manual；证据见 `docs/experiments/EXP-20261013-qwen38-omni-realtime.md` |
| TC-VOC-029 | 新录音打断未完成的 Realtime 工具回合 | integration | 首个 Realtime 录音已 commit，模型仍在执行工具 | 第二次发送 `audio.input.start` | 旧 Realtime 连接取消且不上报“Audio stream already active”/取消噪声；新 stream 立即进入录音状态；旧 finally 不会清掉新 stream | `test/gateway/deviceHub/audioInput.test.js` 的 realtime response interruption 用例 |
| TC-VOC-030 | Realtime 使用 Pi 长期上下文 | integration | Pi session 有 user/assistant/toolResult 历史 | 建立 Realtime provider 请求并观察 replay | 完整 Pi projection 以 user/assistant/function_call/function_call_output 顺序回放；上下文压缩和持久化仍由 Pi 管理 | `test/runtime/agent-pi/qwenRealtimeAdapter.test.js`, `test/runtime/agent-pi/piRuntime.test.js` |
| TC-VOC-038 | Realtime 音频入口不创建第二套 Agent | integration | 假音频 WebSocket、Device Hub 与 Pi runner | start/chunk/end 并注入 transcription.completed | 输入连接只发送 session.update/append/commit，不注册工具、不创建 response；transcript 恰好一次进入所选模型的 Pi 会话 | `test/gateway/deviceHub/omniAudio.test.js`, `test/gateway/deviceHub/audioInput.test.js` |
