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
