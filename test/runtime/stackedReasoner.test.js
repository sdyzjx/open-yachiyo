const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StackedReasoner,
  isUnsupportedResponsesError,
  shouldUseResponses
} = require('../../apps/runtime/llm/stackedReasoner');

function createReasoner(label) {
  return {
    async decide() {
      return { type: 'final', output: `${label}-decide` };
    },
    async decideStream() {
      return { type: 'final', output: `${label}-stream` };
    }
  };
}

test('shouldUseResponses honors endpoint mode and model allowlist', () => {
  assert.equal(shouldUseResponses({
    endpointMode: 'chat',
    responsesConfig: { enabled: true },
    model: 'qwen3.5-plus'
  }), false);

  assert.equal(shouldUseResponses({
    endpointMode: 'responses',
    responsesConfig: { enabled: false },
    model: 'qwen3.5-plus'
  }), true);

  assert.equal(shouldUseResponses({
    endpointMode: 'auto',
    responsesConfig: { enabled: true, model_allowlist: ['qwen3.5-plus'] },
    model: 'qwen3.5-plus'
  }), true);

  assert.equal(shouldUseResponses({
    endpointMode: 'auto',
    responsesConfig: { enabled: true, model_allowlist: ['qwen3.5-plus'] },
    model: 'gpt-4o-mini'
  }), false);
});

test('isUnsupportedResponsesError detects unsupported responses failures', () => {
  assert.equal(isUnsupportedResponsesError(new Error('404 responses unsupported for model')), true);
  assert.equal(isUnsupportedResponsesError({ code: 'RESPONSES_UNSUPPORTED', message: 'bad request' }), true);
  assert.equal(isUnsupportedResponsesError(new Error('timeout while calling responses')), false);
});

test('StackedReasoner routes to chat when auto mode does not allow responses', async () => {
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: createReasoner('responses'),
    endpointMode: 'auto',
    responsesConfig: { enabled: true, model_allowlist: ['qwen3.5-plus'] },
    model: 'gpt-4o-mini'
  });

  const decision = await reasoner.decide({ messages: [], tools: [] });
  assert.equal(decision.output, 'chat-decide');
  assert.equal(decision.route, 'chat');
});

test('StackedReasoner routes to responses when available', async () => {
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: createReasoner('responses'),
    endpointMode: 'auto',
    responsesConfig: { enabled: true, model_allowlist: ['qwen3.5-plus'] },
    model: 'qwen3.5-plus'
  });

  const decision = await reasoner.decideStream({ messages: [], tools: [] });
  assert.equal(decision.output, 'responses-stream');
  assert.equal(decision.route, 'responses');
});

test('StackedReasoner falls back to chat on unsupported responses errors', async () => {
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: {
      async decide() {
        const err = new Error('responses unsupported for this model');
        err.code = 'RESPONSES_UNSUPPORTED';
        throw err;
      },
      async decideStream() {
        throw new Error('not used');
      }
    },
    endpointMode: 'auto',
    responsesConfig: {
      enabled: true,
      fallback_to_chat: true,
      fallback_policy: 'unsupported_only'
    },
    model: 'qwen3.5-plus'
  });

  const decision = await reasoner.decide({ messages: [], tools: [] });
  assert.equal(decision.output, 'chat-decide');
  assert.equal(decision.route, 'chat');
  assert.equal(decision.fallback_from, 'responses');
});

test('StackedReasoner does not fall back on non-unsupported errors when policy is unsupported_only', async () => {
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: {
      async decide() {
        throw new Error('responses timeout');
      },
      async decideStream() {
        throw new Error('not used');
      }
    },
    endpointMode: 'auto',
    responsesConfig: {
      enabled: true,
      fallback_to_chat: true,
      fallback_policy: 'unsupported_only'
    },
    model: 'qwen3.5-plus'
  });

  await assert.rejects(() => reasoner.decide({ messages: [], tools: [] }), /responses timeout/);
});

test('StackedReasoner falls back on any error when policy is any_error', async () => {
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: {
      async decide() {
        throw new Error('responses timeout');
      },
      async decideStream() {
        throw new Error('not used');
      }
    },
    endpointMode: 'auto',
    responsesConfig: {
      enabled: true,
      fallback_to_chat: true,
      fallback_policy: 'any_error'
    },
    model: 'qwen3.5-plus'
  });

  const decision = await reasoner.decide({ messages: [], tools: [] });
  assert.equal(decision.output, 'chat-decide');
  assert.equal(decision.fallback_from, 'responses');
});

test('StackedReasoner injects session cache header and chains previous_response_id by session', async () => {
  const requestOptionsSeen = [];
  const reasoner = new StackedReasoner({
    chatReasoner: createReasoner('chat'),
    responsesReasoner: {
      async decide(payload) {
        requestOptionsSeen.push(payload.requestOptions);
        return {
          type: 'final',
          output: 'responses-decide',
          provider_meta: {
            response_id: requestOptionsSeen.length === 1 ? 'resp_1' : 'resp_2'
          }
        };
      },
      async decideStream() {
        throw new Error('not used');
      }
    },
    endpointMode: 'auto',
    responsesConfig: {
      enabled: true,
      session_cache: {
        enabled: true,
        header_name: 'x-dashscope-session-cache',
        model_allowlist: ['qwen3.5-plus']
      }
    },
    model: 'qwen3.5-plus'
  });

  const first = await reasoner.decide({ messages: [], tools: [], sessionId: 'desktop-session-1' });
  const second = await reasoner.decide({ messages: [], tools: [], sessionId: 'desktop-session-1' });

  assert.equal(first.provider_meta.session_cache_applied, true);
  assert.equal(second.provider_meta.previous_response_id, 'resp_1');
  assert.equal(requestOptionsSeen[0].headers['x-dashscope-session-cache'], 'desktop-session-1');
  assert.equal(requestOptionsSeen[1].body.previous_response_id, 'resp_1');
});
