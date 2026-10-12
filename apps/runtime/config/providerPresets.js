// Provider presets — contract C4.3 in docs/plans/PLAN-android-companion-contracts.md.
// Each preset supplies defaults for a provider entry in providers.yaml (type/base_url/
// api_key_env/models/compat). A provider that sets `preset: <id>` inherits missing fields.

const PRESETS = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    api_key_env: 'OPENAI_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', context_window: 128000, max_tokens: 16384, input: ['text', 'image'] },
      { id: 'gpt-4o', name: 'GPT-4o', context_window: 128000, max_tokens: 16384, input: ['text', 'image'] }
    ],
    compat: {}
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    api_key_env: 'DEEPSEEK_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', context_window: 128000, max_tokens: 8192, reasoning: false, input: ['text'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek R', context_window: 128000, max_tokens: 8192, reasoning: true, input: ['text'] }
    ],
    compat: {
      supports_developer_role: false,
      max_tokens_field: 'max_tokens',
      reasoning_content_field: 'reasoning_content',
      strip_reasoning_in_history: true
    }
  },
  {
    id: 'qwen',
    name: 'Qwen (DashScope)',
    type: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key_env: 'DASHSCOPE_API_KEY',
    requires_api_key: true,
    models: [
      {
        id: 'qwen3.8-omni-flash',
        name: 'Qwen 3.8 Omni Flash',
        context_window: 1048576,
        max_tokens: 131072,
        input: ['text', 'image', 'audio', 'video'],
        output: ['text'],
        transport: 'request',
        audio: { mode: 'direct', input_format: 'wav' }
      },
      {
        id: 'qwen3.8-omni-flash-realtime',
        name: 'Qwen 3.8 Omni Flash Realtime',
        context_window: 65536,
        max_tokens: 8192,
        input: ['text', 'audio', 'video'],
        output: ['text', 'audio'],
        transport: 'realtime',
        audio: { mode: 'realtime', input_format: 'pcm_s16le', input_sample_rate: 16000, output_format: 'pcm_s16le', output_sample_rate: 24000 }
      },
      { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', context_window: 131072, max_tokens: 8192, input: ['text', 'image'] },
      { id: 'qwen-max', name: 'Qwen Max', context_window: 32768, max_tokens: 8192, input: ['text'] }
    ],
    compat: { supports_developer_role: false, max_tokens_field: 'max_tokens' }
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    type: 'openai_compatible',
    base_url: 'https://api.moonshot.cn/v1',
    api_key_env: 'MOONSHOT_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2', context_window: 262144, max_tokens: 8192, input: ['text'] },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32k', context_window: 32768, max_tokens: 8192, input: ['text'] }
    ],
    compat: { supports_developer_role: false, max_tokens_field: 'max_tokens' }
  },
  {
    id: 'zhipu',
    name: 'Zhipu (GLM)',
    type: 'openai_compatible',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    api_key_env: 'ZHIPU_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'glm-4.5', name: 'GLM-4.5', context_window: 128000, max_tokens: 8192, input: ['text'] },
      { id: 'glm-4.5v', name: 'GLM-4.5V', context_window: 64000, max_tokens: 8192, input: ['text', 'image'] }
    ],
    compat: { supports_developer_role: false, max_tokens_field: 'max_tokens' }
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    type: 'openai_compatible',
    base_url: 'https://api.siliconflow.cn/v1',
    api_key_env: 'SILICONFLOW_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (SiliconFlow)', context_window: 64000, max_tokens: 8192, input: ['text'] },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B', context_window: 32768, max_tokens: 8192, input: ['text'] }
    ],
    compat: { supports_developer_role: false, max_tokens_field: 'max_tokens' }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai_compatible',
    base_url: 'https://openrouter.ai/api/v1',
    api_key_env: 'OPENROUTER_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini (OpenRouter)', context_window: 128000, max_tokens: 16384, input: ['text', 'image'] },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (OpenRouter)', context_window: 200000, max_tokens: 8192, input: ['text', 'image'] }
    ],
    compat: { supports_developer_role: false }
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    type: 'openai_compatible',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key_env: null,
    requires_api_key: false,
    models: [
      { id: 'qwen2.5:7b', name: 'Qwen2.5 7B (local)', context_window: 32768, max_tokens: 4096, input: ['text'] }
    ],
    compat: { supports_developer_role: false, max_tokens_field: 'max_tokens' }
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    base_url: 'https://api.anthropic.com',
    api_key_env: 'ANTHROPIC_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context_window: 200000, max_tokens: 8192, input: ['text', 'image'] },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', context_window: 200000, max_tokens: 8192, input: ['text', 'image'] }
    ],
    compat: {}
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'google',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    api_key_env: 'GEMINI_API_KEY',
    requires_api_key: true,
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context_window: 1048576, max_tokens: 8192, input: ['text', 'image'] },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context_window: 1048576, max_tokens: 8192, reasoning: true, input: ['text', 'image'] }
    ],
    compat: {}
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI compatible)',
    type: 'openai_compatible',
    base_url: '',
    api_key_env: null,
    requires_api_key: true,
    models: [],
    compat: {}
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listPresets() {
  return clone(PRESETS);
}

function getPreset(id) {
  const found = PRESETS.find((p) => p.id === String(id || ''));
  return found ? clone(found) : null;
}

module.exports = { listPresets, getPreset, PRESET_IDS: PRESETS.map((p) => p.id) };
