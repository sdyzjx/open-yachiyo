const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiChatTool } = require('../../../apps/runtime/agent-pi/uiChatTool');
const { EventBridge } = require('../../../apps/runtime/agent-pi/eventBridge');

test('TC-PI-045 ui.chat.post publishes one explicit frontend message', async () => {
  const events = [];
  const tool = createUiChatTool({
    onlineNames: new Map(),
    context: () => ({
      session_id: 'device-phone', trace_id: 'trace-1',
      publishRuntimeEvent: (event, payload) => events.push({ event, payload })
    })
  });
  assert.equal(tool.name, 'ui__chat__post');
  const result = await tool.execute('call-1', { text: '  visible reply  ', format: 'plain', bubble: false });
  assert.equal(result.details.delivered, true);
  assert.deepEqual(events, [{
    event: 'ui.chat.post',
    payload: {
      message_id: 'call-1', session_id: 'device-phone', trace_id: 'trace-1', role: 'assistant',
      text: 'visible reply', format: 'plain', bubble: false
    }
  }]);
});

test('TC-PI-045 final result is visible fallback unless ui.chat.post already delivered', () => {
  const fallback = new EventBridge({ sessionId: 's', uiHidden: true });
  assert.equal(fallback.finish('final answer').uiHidden, false);

  const explicit = new EventBridge({ sessionId: 's', uiHidden: true });
  explicit.emit('ui.chat.post', { text: 'explicit answer' });
  const result = explicit.finish('internal acknowledgement');
  assert.equal(result.uiHidden, true);
  assert.equal(explicit.events.at(-1).payload.ui_delivered, true);
});
