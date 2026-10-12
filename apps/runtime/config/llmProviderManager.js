const { OpenAIReasoner } = require('../llm/openaiReasoner');
const { FallbackReasoner } = require('../llm/fallbackReasoner');
const { normalizeProviderConfig } = require('./providerConfigStore');
const { loadModelCatalog } = require('./modelCatalog');

class LlmProviderManager {
  constructor({ store }) {
    this.store = store;
    this.reasonerCache = new Map();
  }

  clearCache() {
    this.reasonerCache.clear();
  }

  getCatalog() {
    return loadModelCatalog({ store: this.store });
  }

  getActiveProviderSnapshot() {
    const config = normalizeProviderConfig(this.store.load());
    const activeName = config.active_provider;
    const provider = config.providers[activeName];

    const resolvedApiKey = provider.api_key || process.env[provider.api_key_env] || null;

    return {
      active_name: activeName,
      provider,
      has_api_key: Boolean(resolvedApiKey)
    };
  }

  buildReasoner(descriptor, provider) {
    if (!descriptor.api_key && provider.requires_api_key !== false
      && provider.auth !== 'none' && provider.preset !== 'ollama') {
      throw new Error(
        `No API key for provider "${descriptor.provider}". Set api_key in YAML or env ${descriptor.api_key_env}.`
      );
    }
    if (descriptor.api !== 'openai-completions') {
      throw new Error(
        `Model ${descriptor.ref} uses api "${descriptor.api}", which the legacy agent loop cannot call; use AGENT_CORE=pi.`
      );
    }

    const maxRetries = Number(
      descriptor.max_retries !== null && descriptor.max_retries !== undefined
        ? descriptor.max_retries
        : process.env.LLM_REQUEST_MAX_RETRIES
    );
    const retryDelayMs = Number(
      provider.retry_delay_ms !== undefined
        ? provider.retry_delay_ms
        : process.env.LLM_REQUEST_RETRY_DELAY_MS
    );

    const options = {
      apiKey: descriptor.api_key,
      requireApiKey: false,
      baseUrl: descriptor.base_url,
      model: descriptor.id,
      timeoutMs: descriptor.timeout_ms,
      maxRetries: Number.isFinite(maxRetries) ? maxRetries : undefined,
      retryDelayMs: Number.isFinite(retryDelayMs) ? retryDelayMs : undefined,
      headers: descriptor.headers,
      extraBody: descriptor.extra_body,
      compat: descriptor.compat,
      temperature: descriptor.temperature,
      maxTokens: descriptor.max_tokens,
      reasoning: descriptor.reasoning
    };

    const key = JSON.stringify({ ref: descriptor.ref, options });
    const cached = this.reasonerCache.get(key);
    if (cached) return cached;
    const reasoner = new OpenAIReasoner(options);
    // Only the latest config generation is kept.
    this.reasonerCache.set(key, reasoner);
    return reasoner;
  }

  // getReasoner() -> active model (plus fallback chain when configured).
  // getReasoner({ modelRef }) -> that model first, then the configured fallbacks.
  // onFallback({from,to,error,status}) is invoked when the chain switches model.
  getReasoner({ modelRef = null, onFallback = null } = {}) {
    const catalog = this.getCatalog();
    const config = this.store.load();
    let primary = catalog.active;
    if (modelRef) {
      primary = catalog.resolve(modelRef);
      if (!primary) throw new Error(`Unknown model_ref: ${modelRef}`);
    }
    if (!primary) throw new Error('No chat model configured');

    const providerOf = (d) => normalizeProviderConfig(config).providers[d.provider] || {};
    const primaryReasoner = this.buildReasoner(primary, providerOf(primary));

    const extras = catalog.fallbackChain().filter((m) => m.ref !== primary.ref);
    const chain = [{ ref: primary.ref, reasoner: primaryReasoner }];
    for (const model of extras) {
      try {
        chain.push({ ref: model.ref, reasoner: this.buildReasoner(model, providerOf(model)) });
      } catch {
        // A fallback without credentials / supported api is skipped, not fatal.
      }
    }
    if (chain.length === 1) return primaryReasoner;
    return new FallbackReasoner({ chain, onFallback });
  }

  loadYaml() {
    return this.store.loadRawYaml();
  }

  getConfig() {
    return this.store.load();
  }

  saveYaml(rawYaml) {
    const config = this.store.saveRawYaml(rawYaml);
    this.clearCache();
    return config;
  }

  saveConfig(config) {
    this.store.save(config);
    this.clearCache();
    return this.store.load();
  }

  getConfigSummary() {
    const config = normalizeProviderConfig(this.store.load());
    const activeName = config.active_provider;
    const active = config.providers[activeName];
    const hasApiKey = Boolean(active.api_key || process.env[active.api_key_env]);
    const activeRef = config.active_model || null;
    const activeModelId = activeRef && activeRef.startsWith(`${activeName}/`)
      ? activeRef.slice(activeName.length + 1)
      : active.model;

    return {
      active_provider: activeName,
      providers: Object.keys(config.providers),
      active_model: activeModelId,
      active_ref: activeRef,
      active_base_url: active.base_url,
      active_type: active.type,
      has_api_key: hasApiKey
    };
  }
}

module.exports = { LlmProviderManager };
