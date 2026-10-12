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
