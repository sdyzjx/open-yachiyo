function isUnsupportedResponsesError(err) {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  if (code.includes('unsupported') || code.includes('not_implemented')) {
    return true;
  }
  return (
    message.includes('unsupported')
    || message.includes('not support')
    || message.includes('not implemented')
    || message.includes('404')
  );
}

function shouldUseResponses({ endpointMode, responsesConfig, model }) {
  const normalizedMode = String(endpointMode || 'auto').trim().toLowerCase();
  if (normalizedMode === 'chat') return false;
  if (normalizedMode === 'responses') return true;

  if (!responsesConfig?.enabled) return false;

  const allowlist = Array.isArray(responsesConfig?.model_allowlist)
    ? responsesConfig.model_allowlist.filter((item) => typeof item === 'string' && item.trim())
    : [];
  if (allowlist.length === 0) return true;
  return allowlist.includes(String(model || '').trim());
}

class StackedReasoner {
  constructor({
    chatReasoner,
    responsesReasoner,
    endpointMode = 'auto',
    responsesConfig = {},
    model = ''
  } = {}) {
    this.chatReasoner = chatReasoner || null;
    this.responsesReasoner = responsesReasoner || null;
    this.endpointMode = endpointMode;
    this.responsesConfig = responsesConfig && typeof responsesConfig === 'object' ? responsesConfig : {};
    this.model = model;
    this.previousResponseIdBySession = new Map();
  }

  canUseResponses() {
    return Boolean(this.responsesReasoner) && shouldUseResponses({
      endpointMode: this.endpointMode,
      responsesConfig: this.responsesConfig,
      model: this.model
    });
  }

  shouldFallback(err) {
    if (!this.responsesConfig?.fallback_to_chat) return false;
    const fallbackPolicy = String(this.responsesConfig?.fallback_policy || 'unsupported_only');
    if (fallbackPolicy === 'any_error') return true;
    return isUnsupportedResponsesError(err);
  }

  shouldApplySessionCache(sessionId) {
    if (!sessionId) return false;
    const sessionCache = this.responsesConfig?.session_cache;
    if (!sessionCache?.enabled) return false;
    const allowlist = Array.isArray(sessionCache?.model_allowlist)
      ? sessionCache.model_allowlist.filter((item) => typeof item === 'string' && item.trim())
      : [];
    if (allowlist.length === 0) return true;
    return allowlist.includes(String(this.model || '').trim());
  }

  buildResponsesRequestOptions(payload = {}) {
    const sessionId = String(payload?.sessionId || payload?.session_id || '').trim();
    const requestOptions = {
      headers: {
        ...(payload?.requestOptions?.headers || {})
      },
      body: {
        ...(payload?.requestOptions?.body || {})
      }
    };

    const sessionCacheApplied = this.shouldApplySessionCache(sessionId);
    if (sessionCacheApplied) {
      const headerName = String(
        this.responsesConfig?.session_cache?.header_name || 'x-dashscope-session-cache'
      ).trim();
      requestOptions.headers[headerName] = sessionId;
    }

    const previousResponseId = sessionId ? this.previousResponseIdBySession.get(sessionId) : null;
    if (previousResponseId && !requestOptions.body.previous_response_id) {
      requestOptions.body.previous_response_id = previousResponseId;
    }

    return {
      requestOptions,
      sessionId,
      sessionCacheApplied
    };
  }

  attachRoutingMeta(decision, route, fallbackFrom = null, extraProviderMeta = null) {
    return {
      ...decision,
      route,
      fallback_from: fallbackFrom,
      provider_meta: {
        ...(decision?.provider_meta || {}),
        ...(extraProviderMeta || {})
      }
    };
  }

  async runResponses(methodName, payload) {
    const { requestOptions, sessionId, sessionCacheApplied } = this.buildResponsesRequestOptions(payload);
    try {
      const decision = await this.responsesReasoner[methodName]({
        ...payload,
        requestOptions
      });
      const responseId = decision?.provider_meta?.response_id || null;
      if (sessionId && responseId) {
        this.previousResponseIdBySession.set(sessionId, responseId);
      }
      return this.attachRoutingMeta(decision, 'responses', null, {
        session_cache_applied: sessionCacheApplied,
        previous_response_id: requestOptions.body.previous_response_id || null
      });
    } catch (err) {
      if (!this.chatReasoner || !this.shouldFallback(err)) {
        throw err;
      }
      const fallbackDecision = await this.chatReasoner[methodName](payload);
      return this.attachRoutingMeta(fallbackDecision, 'chat', 'responses', {
        session_cache_applied: sessionCacheApplied,
        fallback_reason: err?.message || String(err || 'responses fallback')
      });
    }
  }

  async runChat(methodName, payload) {
    const decision = await this.chatReasoner[methodName](payload);
    return this.attachRoutingMeta(decision, 'chat');
  }

  async decide(payload) {
    if (this.canUseResponses()) {
      return this.runResponses('decide', payload);
    }
    return this.runChat('decide', payload);
  }

  async decideStream(payload) {
    if (this.canUseResponses()) {
      return this.runResponses('decideStream', payload);
    }
    return this.runChat('decideStream', payload);
  }
}

module.exports = {
  StackedReasoner,
  isUnsupportedResponsesError,
  shouldUseResponses
};
