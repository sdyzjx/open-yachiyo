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

  attachRoutingMeta(decision, route, fallbackFrom = null) {
    return {
      ...decision,
      route,
      fallback_from: fallbackFrom
    };
  }

  async runResponses(methodName, payload) {
    try {
      const decision = await this.responsesReasoner[methodName](payload);
      return this.attachRoutingMeta(decision, 'responses');
    } catch (err) {
      if (!this.chatReasoner || !this.shouldFallback(err)) {
        throw err;
      }
      const fallbackDecision = await this.chatReasoner[methodName](payload);
      return this.attachRoutingMeta(fallbackDecision, 'chat', 'responses');
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
