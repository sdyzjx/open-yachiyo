# Provider 配置指南

本文说明 `open-yachiyo` 当前系统中 provider 的真实配置方式、字段约束、推荐写法，以及图形化配置页面的使用边界。

## 1. 适用范围

当前系统里，`providers.yaml` 同时承载两类 provider：

1. 文本模型 provider
2. TTS provider

> 本文第 1–14 节描述 v1 写法，仍然完全有效。schema v2（多模型、预设、DeepSeek/Kimi/GLM 等、回退链、会话级模型覆盖）见 **第 15 节**；功能说明见 `docs/features/FEAT-llm-model-config-v2.md`。

目前代码层面支持的 provider 类型：

- `openai_compatible`（文本模型，含 DeepSeek / Kimi / GLM / SiliconFlow / OpenRouter / Ollama 等一切 OpenAI 兼容服务）
- `anthropic`、`google`（v2 新增；由 Model Catalog 描述，供 pi 核心使用，legacy 循环暂不直接调用）
- `tts_dashscope`（TTS）
- `asr_openai_compatible`、`asr_dashscope`（v2 新增，语音识别）

## 2. 生效配置文件在哪里

默认情况下，系统实际读取的不是仓库里的模板，而是运行时目录下的配置文件：

- `~/yachiyo/config/providers.yaml`

如果设置了环境变量 `YACHIYO_HOME`，则实际路径会变成：

- `$YACHIYO_HOME/config/providers.yaml`

也就是说：

- 仓库里的 `config/providers.yaml` 更像模板或样例
- 真正生效的是运行时目录里的 `providers.yaml`

## 3. 配置文件结构

标准结构如下：

```yaml
active_provider: qwen35_plus

providers:
  qwen35_plus:
    type: openai_compatible
    display_name: Qwen 3.5 Plus
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3.5-plus
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 20000

  openai:
    type: openai_compatible
    display_name: OpenAI
    base_url: https://api.openai.com/v1
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY
    timeout_ms: 20000

  qwen3_tts:
    type: tts_dashscope
    display_name: Qwen3 TTS VC
    base_url: https://dashscope.aliyuncs.com/api/v1
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 60000
    tts_model: qwen3-tts-vc-2026-01-22
    tts_voice: qwen-tts-vc-xxxxxxxx
    tts_realtime_model: qwen3-tts-vc-realtime-2026-01-15
    tts_realtime_voice: qwen-tts-vc-yyyyyyyy
```

## 4. `active_provider` 是什么

`active_provider` 只决定当前文本模型默认使用哪个 provider。

例如：

```yaml
active_provider: qwen35_plus
```

表示 Runtime 会把 `qwen35_plus` 作为当前 LLM provider。

重要约束：

- `active_provider` 必须指向 `providers` 里已存在的 key
- 在当前系统里，它应该指向一个 `openai_compatible` provider
- 不要把 `active_provider` 指到 `tts_dashscope` 类型上

原因是当前 LLM manager 读取 `active_provider` 时，要求目标 provider 具备：

- `base_url`
- `model`
- `api_key` 或 `api_key_env`

而 `tts_dashscope` 主要字段是 `tts_model` 和 `tts_voice`，不是给文本推理链路用的。

## 5. 文本模型 provider 配置

### 5.1 必填字段

`type: openai_compatible` 时，至少需要：

- `type`
- `base_url`
- `model`
- `api_key` 或 `api_key_env`

推荐同时配置：

- `display_name`
- `timeout_ms`

可选增强字段：

- `max_retries`
- `retry_delay_ms`

示例：

```yaml
qwen35_plus:
  type: openai_compatible
  display_name: Qwen 3.5 Plus
  base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3.5-plus
  api_key_env: DASHSCOPE_API_KEY
  timeout_ms: 20000
  max_retries: 2
  retry_delay_ms: 300
```

### 5.2 当前系统如何消费这些字段

当前 LLM provider manager 实际消费的核心字段是：

- `base_url`
- `model`
- `api_key` / `api_key_env`
- `timeout_ms`
- `max_retries`
- `retry_delay_ms`

也就是说，provider 里就算还有其他扩展字段，只有对应适配器显式读取了，才会生效。

## 6. TTS provider 配置

### 6.1 当前系统的 TTS provider

当前系统里，TTS 推荐统一收敛为：

- `providers.qwen3_tts`

其类型应为：

- `tts_dashscope`

### 6.2 必填字段

`type: tts_dashscope` 时，至少需要：

- `type`
- `base_url`
- `tts_model`
- `tts_voice`
- `api_key` 或 `api_key_env`

常见推荐字段：

- `display_name`
- `timeout_ms`
- `tts_realtime_model`
- `tts_realtime_voice`

示例：

```yaml
qwen3_tts:
  type: tts_dashscope
  display_name: Qwen3 TTS VC
  base_url: https://dashscope.aliyuncs.com/api/v1
  api_key_env: DASHSCOPE_API_KEY
  timeout_ms: 60000
  tts_model: qwen3-tts-vc-2026-01-22
  tts_voice: qwen-tts-vc-xxxxxxxx
  tts_realtime_model: qwen3-tts-vc-realtime-2026-01-15
  tts_realtime_voice: qwen-tts-vc-yyyyyyyy
```

### 6.3 字段含义

- `tts_model`
  非流式 TTS 默认模型
- `tts_voice`
  非流式 TTS 默认音色
- `tts_realtime_model`
  流式 TTS 默认模型
- `tts_realtime_voice`
  流式 TTS 默认音色
- `base_url`
  DashScope HTTP 接口地址
- `timeout_ms`
  TTS 请求超时时间

## 7. 推荐 provider 组合

对当前系统，推荐至少保留三类条目：

1. 一个主文本 provider
2. 一个备用文本 provider
3. 一个固定的 TTS provider

推荐组合：

- 主文本 provider：DashScope Qwen
- 备用文本 provider：OpenAI
- TTS provider：`qwen3_tts`

示例：

```yaml
active_provider: qwen35_plus

providers:
  qwen35_plus:
    type: openai_compatible
    display_name: Qwen 3.5 Plus
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3.5-plus
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 20000

  openai:
    type: openai_compatible
    display_name: OpenAI
    base_url: https://api.openai.com/v1
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY
    timeout_ms: 20000

  qwen3_tts:
    type: tts_dashscope
    display_name: Qwen3 TTS VC
    base_url: https://dashscope.aliyuncs.com/api/v1
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 60000
    tts_model: qwen3-tts-vc-2026-01-22
    tts_voice: qwen-tts-vc-xxxxxxxx
    tts_realtime_model: qwen3-tts-vc-realtime-2026-01-15
    tts_realtime_voice: qwen-tts-vc-yyyyyyyy
```

## 8. `api_key` 和 `api_key_env` 怎么选

系统允许两种方式：

- 直接写 `api_key`
- 写 `api_key_env`，运行时从环境变量读取

推荐优先使用环境变量：

```yaml
api_key_env: DASHSCOPE_API_KEY
```

不推荐把真实密钥直接写进仓库里的配置文件，原因很直接：

- 容易进 Git 历史
- 容易被误传
- 更难切换环境

本地 shell 示例：

```bash
export DASHSCOPE_API_KEY="your_key_here"
export OPENAI_API_KEY="your_key_here"
```

## 9. 图形化配置页面怎么用

当前 Gateway 提供以下配置入口：

- `/config.html`
- `/api/config/providers/config`
- `/api/config/providers/raw`

图形化页面支持两种编辑模式：

1. Graph Config
2. Raw YAML

### 9.1 Graph Config 适合什么

Graph Config 主要适合维护 `openai_compatible` 类型的文本 provider。

它能编辑的核心字段是：

- provider key
- display name
- base_url
- model
- api_key_env / api_key
- timeout_ms

### 9.2 Graph Config 的限制

当前 Graph Config 不适合编辑 `tts_dashscope` provider。

原因是它构建配置时会把 provider 类型固定写成：

- `openai_compatible`

而且图形字段里并没有：

- `tts_model`
- `tts_voice`
- `tts_realtime_model`
- `tts_realtime_voice`

这意味着：

- 如果你在 Graph Config 里保存包含 `qwen3_tts` 的配置，TTS 字段有被覆盖或丢失的风险

结论：

- 文本 provider 可以用 Graph Config
- TTS provider 必须优先用 Raw YAML 编辑

## 10. 推荐编辑策略

推荐按这个规则操作：

- 新增或切换文本 provider：可以用 `/config.html` 的 Graph Config
- 修改 `qwen3_tts`：用 Raw YAML
- 大改 provider 结构：用 Raw YAML
- 想保留全部字段：用 Raw YAML

更稳妥的做法是：

1. 用 Graph Config 管理文本模型
2. 用 Raw YAML 维护 `qwen3_tts`
3. 保存后重新检查 YAML 是否完整

## 11. 保存后何时生效

当前配置保存后，会刷新 provider manager 的内部缓存。

可以理解为：

- 后续请求会读取新配置
- 新会话会使用新配置
- 不需要重启整个项目才能让 provider 切换生效

但如果你改的是环境变量本身，而不是 YAML 文件，通常仍需要让运行进程重新加载环境。

## 12. 常见错误

### 12.1 `active_provider not found in providers`

原因：

- `active_provider` 指向了不存在的 key

修复：

- 确认 `active_provider` 名字和 `providers` 中的 key 完全一致

### 12.2 `provider xxx must define api_key or api_key_env`

原因：

- provider 没有配置密钥来源

修复：

- 增加 `api_key`
- 或增加 `api_key_env`

### 12.3 `provider xxx must define model`

原因：

- `openai_compatible` provider 缺少 `model`

修复：

- 补充 `model`

### 12.4 `provider xxx must define tts_model` 或 `tts_voice`

原因：

- `tts_dashscope` provider 缺少 TTS 必需字段

修复：

- 补上 `tts_model`
- 补上 `tts_voice`

### 12.5 文本模型突然不可用

优先排查：

- `active_provider` 是否错误切到了 TTS provider
- `base_url` 是否写错
- `api_key_env` 对应的环境变量是否真的存在
- Graph Config 是否误覆盖了原有 YAML

## 13. 推荐维护规则

- `active_provider` 只给文本模型用，不给 TTS 用
- `qwen3_tts` 单独保留，不参与文本 provider 切换
- 密钥优先走环境变量
- TTS provider 优先用 Raw YAML 编辑
- 配完后先检查 `providers.yaml`，再进行实际调用验证

## 14. 结论

对当前系统，最稳妥的 provider 配置方式是：

- 使用 `openai_compatible` 管理文本模型
- 使用 `tts_dashscope` 管理 TTS
- 把 `active_provider` 固定指向文本 provider
- 把 `qwen3_tts` 作为独立 TTS provider 保留
- 文本 provider 可用 Graph Config 维护
- TTS provider 只用 Raw YAML 维护

## 15. Schema v2：多 provider / 多模型

### 15.1 结构

```yaml
version: 2
active_model: deepseek/deepseek-chat        # "<provider_key>/<model_id>"
enabled_models: [deepseek/deepseek-chat, deepseek/deepseek-reasoner, qwen35_plus/qwen3.5-plus]
roles: { chat: deepseek/deepseek-chat, vision: qwen35_plus/qwen3.5-plus, summary: deepseek/deepseek-chat }
fallback_models: [qwen35_plus/qwen3.5-plus]
providers:
  deepseek:
    preset: deepseek          # 继承 type/base_url/models/compat；可覆盖任何字段
    api_key_env: DEEPSEEK_API_KEY
    timeout_ms: 60000
    max_retries: 2
    headers: {}               # 额外请求头
    extra_body: {}            # 原样合并进请求体
    compat:                   # 协议差异
      supports_developer_role: false
      max_tokens_field: max_tokens        # 或 max_completion_tokens
      reasoning_content_field: reasoning_content
      strip_reasoning_in_history: true
    models:
      - { id: deepseek-chat, name: DeepSeek V3, max_tokens: 8192 }
      - { id: deepseek-reasoner, name: DeepSeek R, reasoning: true }
```

- v1 文件（`active_provider` + `model`）无需迁移：读取时自动规范化为 v2 视图；`model: x` 等价于 `models: [{id: x}]`。
- 模型引用 `ref` 为 `<provider_key>/<model_id>`（model id 可含 `/`，如 OpenRouter 的 `openai/gpt-4o`）。
- `enabled_models`/`roles`/`fallback_models`/`active_model` 引用不存在的模型时，保存会被拒绝。
- `ollama` 预设无需 API Key；其他 provider 需要 `api_key` 或 `api_key_env`。

### 15.2 预设

`openai`、`deepseek`、`qwen`、`moonshot`（Kimi）、`zhipu`（GLM）、`siliconflow`、`openrouter`、`ollama`、`anthropic`、`gemini`、`custom`。默认环境变量：`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`MOONSHOT_API_KEY`、`ZHIPU_API_KEY`、`SILICONFLOW_API_KEY`、`OPENROUTER_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`。最小 DeepSeek 配置：

```yaml
active_model: deepseek/deepseek-chat
providers:
  deepseek: { preset: deepseek, api_key_env: DEEPSEEK_API_KEY }
```

### 15.3 DeepSeek reasoner 与推理内容

`deepseek-reasoner` 的流式 `reasoning_content` 不会混入回复文本；回放历史时默认剔除（`strip_reasoning_in_history`，DeepSeek 要求如此）。

### 15.4 回退链与运行时切换

- 主模型遇到可重试错误（网络/超时/408/409/429/5xx）时按 `fallback_models` 顺序尝试下一个模型，并发布 `llm.fallback` 事件；401/400 等不会触发回退。已经向客户端流出文本后不再切换。
- `runtime.run` 的 `params.model_ref` 覆盖本次所用模型；`PUT /api/sessions/:id/settings {settings:{model_ref}}` 持久覆盖会话模型（`null` 清除）。

### 15.5 配置页与 API

- 配置页 `/config-v2.html` 的 **models** 标签页：选择预设添加 provider、编辑 base_url / 密钥 / 模型列表 / headers / compat / extra_body，「发现模型」调用 `GET {base_url}/models`，「测试连接」发送最小请求，勾选启用、选择当前模型、按用途分配、编辑回退链。已保存的 API Key 不会回显，留空表示保持不变。
- HTTP：`GET /api/config/models`、`PUT /api/config/models/selection`、`GET /api/config/models/presets`、`POST /api/config/models/test`、`POST /api/config/models/discover`（详见 FEAT 文档）。保存后会提交到 config 目录的 git 仓库。

## 16. 语音 provider（TTS / ASR）与 `voice` 段

`providers.yaml` 可声明多个语音 provider，并用顶层 `voice` 段选择当前使用的一个（可选，缺省保持旧行为）：

```yaml
voice:
  active_tts: qwen_tts          # 缺省 → 环境变量 TTS_PROVIDER_KEY → 第一个 tts_* provider
  active_asr: aliyun_asr        # 缺省 → 第一个 asr_* provider
providers:
  qwen_tts:   { type: tts_dashscope, base_url: https://dashscope.aliyuncs.com/api/v1, api_key_env: DASHSCOPE_API_KEY, tts_model: qwen3-tts-flash, tts_voice: Cherry, tts_realtime_model: qwen3-tts-flash-realtime }
  openai_tts: { type: tts_openai_compatible, base_url: https://api.openai.com/v1, api_key_env: OPENAI_API_KEY, tts_model: gpt-4o-mini-tts, tts_voice: alloy, format: mp3 }
  aliyun_asr: { type: asr_dashscope, base_url: https://dashscope.aliyuncs.com/api/v1, api_key_env: DASHSCOPE_API_KEY, model: qwen3-asr-flash }   # 旧字段 asr_model 仍可读
```

- 校验：`voice.active_tts` 必须指向存在的 `tts_*` provider，`voice.active_asr` 必须指向存在的 `asr_*` provider，否则保存时给出明确错误。
- 旧配置的 `qwen3_tts` key 无需迁移；本指南前文中对 `qwen3_tts` 的描述等价于「`voice.active_tts` 指向的 `tts_dashscope` provider」。
- 完整行为、接口与错误码见 `docs/features/FEAT-voice-provider-config.md`。
