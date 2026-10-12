const { loadPi } = require('./loadPi');
const APIS = new Set(['openai-completions', 'anthropic-messages', 'google-generative-ai']);

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

function requestOptions(descriptor, options = {}) {
  const reasoningField = descriptor.compat?.reasoning_content_field;
  return {
    ...options,
    ...(descriptor.api === 'openai-completions' && reasoningField && reasoningField !== 'reasoning_content'
      ? { fetch: reasoningFetch(options.fetch || globalThis.fetch, reasoningField) } : {}),
    timeoutMs: descriptor.timeout_ms || 60000,
    maxRetries: descriptor.max_retries ?? 0,
    ...(descriptor.temperature !== null && descriptor.temperature !== undefined ? { temperature: descriptor.temperature } : {}),
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
      return (await options.onPayload?.(next, model)) ?? next;
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
  const status = Number(error?.status || error?.statusCode);
  if (status) return status === 429 || status >= 500;
  return /\b429\b|\b5\d\d\b|network|fetch failed|connection|ECONN|ETIMEDOUT|timed? out|timeout|socket/i.test(String(error?.message || error));
}

module.exports = { toPiModel, selectModels, requestOptions, createModelRuntime, isRetryableModelError };
