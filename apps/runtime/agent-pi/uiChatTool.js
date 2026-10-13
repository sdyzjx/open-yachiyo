const { allocateToolName, textResult } = require('./toolBridge');

const UI_CHAT_TOOL_NAME = 'ui.chat.post';

function createUiChatTool({ context, onlineNames = new Map() }) {
  const name = allocateToolName(UI_CHAT_TOOL_NAME, onlineNames);
  return {
    name,
    originalName: UI_CHAT_TOOL_NAME,
    label: UI_CHAT_TOOL_NAME,
    description: 'Post a user-visible text message to the Yachiyo chat surface. Use this only when a text bubble improves the reply; native Realtime audio and other tools are independent.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 20000, description: 'The complete user-visible message.' },
        format: { type: 'string', enum: ['plain', 'markdown'], default: 'markdown' },
        bubble: { type: 'boolean', default: true, description: 'Also show the transient character bubble.' }
      }
    },
    executionMode: 'sequential',
    async execute(callId, args, signal) {
      signal?.throwIfAborted();
      const text = String(args?.text || '').trim();
      if (!text) throw new Error('ui.chat.post requires non-empty text');
      if (text.length > 20000) throw new Error('ui.chat.post text exceeds 20000 characters');
      const current = typeof context === 'function' ? context() : context;
      const payload = {
        message_id: callId,
        session_id: current?.session_id || null,
        trace_id: current?.trace_id || null,
        role: 'assistant',
        text,
        format: args?.format === 'plain' ? 'plain' : 'markdown',
        bubble: args?.bubble !== false
      };
      current?.publishRuntimeEvent?.('ui.chat.post', payload);
      return textResult('Message delivered to the Yachiyo chat surface.', {
        delivered: true,
        channel: 'ui.chat',
        message_id: callId
      });
    }
  };
}

module.exports = { UI_CHAT_TOOL_NAME, createUiChatTool };
