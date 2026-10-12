const { loadPi } = require('./loadPi');
const APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']);
const CHATGPT_UNSUPPORTED_FIELDS = [
  'background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation',
  'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature',
  'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id'
];

function toPiModel(descriptor) {
  if (!descriptor || !APIS.has(descriptor.api)) throw new Error('Unsupported or missing model API');
  const c = descriptor.compat || {};
  const compat = { ...c };
  for (const [source, target] of Object.entries({
    supports_developer_role: 'supportsDeveloperRole', max_tokens_field: 'maxTokensField',
    supports_finish_reason: 'supportsFinishReason', supports_reasoning_effort: 'supportsReasoningEffort'
  })) {
    if (c[source] !== undefined) compat[target] = c[source];
    delete compat[source];
  }
  delete compat.reasoning_content_field;
  delete compat.strip_reasoning_in_history;
  if (descriptor.api === 'openai-completions') {
    compat.requiresToolResultName ??= true;
    // Older compatible endpoints and the legacy local mock omit finish_reason.
    compat.supportsFinishReason ??= false;
  }
  return {
    id: descriptor.id, name: descriptor.name || descriptor.id, provider: descriptor.provider,
    api: descriptor.api, baseUrl: descriptor.base_url, reasoning: Boolean(descriptor.reasoning),
    input: descriptor.input || ['text'], contextWindow: descriptor.context_window || 128000,
    maxTokens: descriptor.max_tokens || 8192, headers: { ...descriptor.headers }, compat,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

function selectModels(catalog, modelRef) {
  const override = modelRef ? catalog.resolve(modelRef) : null;
  if (modelRef && !override) throw new Error(`Unknown model_ref: ${modelRef}`);
  const chain = [override, ...catalog.fallbackChain()].filter(Boolean);
  if (!chain.length) throw new Error('No chat model configured');
  return chain.filter((item, i) => chain.findIndex((other) => other.ref === item.ref) === i);
}

// Normalize a provider-specific reasoning field before pi-ai parses SSE. Keep
// decoding incremental: a UTF-8 character or JSON frame may span chunks.
function reasoningFetch(fetchImpl, field) {
  return async (...args) => {
    const response = await fetchImpl(...args);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
    let pending = '';
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const normalize = (line) => {
      if (!line.startsWith('data:')) return line;
      try {
        const data = JSON.parse(line.slice(5).trim());
        for (const choice of data.choices || []) {
          if (typeof choice.delta?.[field] === 'string') {
            choice.delta.reasoning_content = choice.delta[field];
            if (field !== 'reasoning_content') delete choice.delta[field];
          }
        }
        return `data: ${JSON.stringify(data)}`;
      } catch { return line; }
    };
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) controller.enqueue(encoder.encode(`${normalize(line)}\n`));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(normalize(pending)));
      }
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

function sanitizeChatGPTPlanPayload(payload) {
  const next = { ...payload };
  for (const field of CHATGPT_UNSUPPORTED_FIELDS) delete next[field];
  next.store = false;
  next.stream = true;
  if (Array.isArray(next.input)) {
    next.input = next.input.map((item) => item?.role === 'system' ? { ...item, role: 'developer' } : item);
  }
  if (Array.isArray(next.tools) && next.tools.length) {
    const functions = next.tools.filter((tool) => tool?.type === 'function' || tool?.type === 'custom');
    if (functions.length !== next.tools.length) {
      throw new Error('ChatGPT plan requests only support local function/custom tools');
    }
    next.tools = [{
      type: 'namespace', name: 'yachiyo',
      description: 'Local tools executed by the Yachiyo pi agent runtime.',
      tools: functions
    }];
  }
  return next;
}

function refreshOnceOnUnauthorized(fetchImpl, refreshAccessToken) {
  return async (input, init) => {
    const request = new Request(input, init);
    const retry = request.clone();
    const response = await fetchImpl(request);
    if (response.status !== 401) return response;
    await response.body?.cancel?.();
    const headers = new Headers(retry.headers);
    headers.set('authorization', `Bearer ${await refreshAccessToken()}`);
    return fetchImpl(new Request(retry, { headers }));
  };
}

function requestOptions(descriptor, options = {}) {
  const reasoningField = descriptor.compat?.reasoning_content_field;
  let requestFetch = options.fetch || globalThis.fetch;
  if (descriptor.api === 'openai-completions' && reasoningField && reasoningField !== 'reasoning_content') {
    requestFetch = reasoningFetch(requestFetch, reasoningField);
  }
  if (descriptor.chatgpt_plan && typeof descriptor.refresh_access_token === 'function') {
    requestFetch = refreshOnceOnUnauthorized(requestFetch, descriptor.refresh_access_token);
  }
  return {
    ...options,
    ...(requestFetch !== globalThis.fetch || options.fetch ? { fetch: requestFetch } : {}),
    timeoutMs: descriptor.timeout_ms || 60000,
    maxRetries: descriptor.chatgpt_plan ? 0 : (descriptor.max_retries ?? 0),
    ...(!descriptor.chatgpt_plan && descriptor.temperature !== null && descriptor.temperature !== undefined
      ? { temperature: descriptor.temperature } : {}),
    headers: { ...descriptor.headers, ...options.headers },
    onPayload: async (payload, model) => {
      const next = { ...payload, ...descriptor.extra_body };
      if (Array.isArray(next.messages)) {
        next.messages = next.messages.map((message) => {
          const copy = { ...message };
          if (Array.isArray(copy.content) && copy.content.every((part) => part.type === 'text')) {
            copy.content = copy.content.map((part) => part.text).join('');
          }
          if (reasoningField && !descriptor.compat?.strip_reasoning_in_history) {
            const thinking = copy.reasoning_content ?? copy.reasoning ?? copy.reasoning_text;
            if (thinking !== undefined) {
              delete copy.reasoning_content;
              delete copy.reasoning;
              delete copy.reasoning_text;
              copy[reasoningField] = thinking;
            }
          }
          if (descriptor.compat?.strip_reasoning_in_history) {
            for (const field of ['reasoning', 'reasoning_content', 'reasoning_text', descriptor.compat.reasoning_content_field]) {
              if (field) delete copy[field];
            }
          }
          return copy;
        });
      }
      const transformed = (await options.onPayload?.(next, model)) ?? next;
      return descriptor.chatgpt_plan ? sanitizeChatGPTPlanPayload(transformed) : transformed;
    }
  };
}

async function createModelRuntime(catalog) {
  const { sdk, ai, apis } = await loadPi();
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(),
    modelsPath: null, refreshOnCreate: false, allowModelNetwork: false
  });
  const grouped = new Map();
  for (const descriptor of catalog.models) {
    const list = grouped.get(descriptor.provider) || [];
    list.push(descriptor);
    grouped.set(descriptor.provider, list);
  }
  for (const [provider, descriptors] of grouped) {
    runtime.registerProvider(provider, {
      api: descriptors[0].api, baseUrl: descriptors[0].base_url,
      models: descriptors.map(toPiModel),
      streamSimple: (model, context, options) => {
        const descriptor = descriptors.find((item) => item.id === model.id);
        return apis[model.api].streamSimple(model, context, requestOptions(descriptor, options));
      }
    });
    // Runtime overrides are literal values, unlike models.json command interpolation.
    await runtime.setRuntimeApiKey(provider, descriptors[0].api_key || 'yachiyo-local-no-key');
  }
  return runtime;
}

function isRetryableModelError(error) {
  if (/subscription_sharing_|chatpass_v2_|ChatGPT plan usage|ChatGPT is not connected/i.test(String(error?.message || error))) return false;
  const status = Number(error?.status || error?.statusCode);
  if (status) return status === 429 || status >= 500;
  return /\b429\b|\b5\d\d\b|network|fetch failed|connection|ECONN|ETIMEDOUT|timed? out|timeout|socket/i.test(String(error?.message || error));
}

module.exports = {
  CHATGPT_UNSUPPORTED_FIELDS, toPiModel, selectModels, requestOptions, createModelRuntime,
  isRetryableModelError, sanitizeChatGPTPlanPayload, refreshOnceOnUnauthorized
};
