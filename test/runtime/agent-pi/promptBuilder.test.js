const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoopRunner } = require('../../../apps/runtime/loop/toolLoopRunner');
const { RuntimeEventBus } = require('../../../apps/runtime/bus/eventBus');
const { buildPrompt } = require('../../../apps/runtime/agent-pi/promptBuilder');

test('TC-PI-010 prompt migration preserves each legacy system paragraph', async () => {
  let legacyMessages;
  const args = {
    sessionId: 's', input: '叫我 Alice', runtimeContext: { permission_level: 'high', voice_auto_reply_enabled: true, voice_auto_reply_mode: 'force_on' },
    seedMessages: [{ role: 'system', content: 'Long-term memory SOP\npolicy' }, { role: 'system', content: 'Bootstrap long-term memory context\nblue' }]
  };
  const deps = {
    resolvePersonaContext: async () => ({ prompt: 'SOUL\nIDENTITY\nUSER\nprofile' }),
    resolveSkillsContext: async () => ({ prompt: 'Available skills: example', selected: ['example'] }),
    tools: [{ name: 'desktop.capture.screen' }, { name: 'desktop.locate.capture' }]
  };
  const runner = new ToolLoopRunner({ bus: new RuntimeEventBus(), ...deps, listTools: () => deps.tools,
    getReasoner: () => ({ decide: async ({ messages }) => { legacyMessages = messages; return { type: 'final', output: 'ok' }; } })
  });
  await runner.run(args);
  const { systemPrompt } = await buildPrompt({ ...args, ...deps });
  for (const message of legacyMessages.filter((m) => m.role === 'system')) {
    assert.ok(systemPrompt.includes(message.content), `Missing paragraph: ${message.content}`);
  }
  assert.match(systemPrompt, /Session permission level: high/);
});

test('TC-PI-011 low permission omits memory seeds and voice force-off instructions', async () => {
  const { systemPrompt } = await buildPrompt({ sessionId: 's', input: 'hello', runtimeContext: { permission_level: 'low', voice_auto_reply_enabled: false },
    seedMessages: [{ role: 'system', content: 'Long-term memory SOP secret' }]
  });
  assert.doesNotMatch(systemPrompt, /secret|Voice auto-reply/);
  assert.match(systemPrompt, /memory access is disabled/);
});

test('TC-PI-028 voice prompt prioritizes immediate TTS for audio turns', async () => {
  const { systemPrompt } = await buildPrompt({
    sessionId: 'voice-first',
    input: '你好',
    runtimeContext: {
      permission_level: 'medium',
      voice_auto_reply_enabled: true,
      voice_auto_reply_mode: 'policy',
      input_type: 'audio'
    }
  });
  assert.match(systemPrompt, /current user input type is audio/i);
  assert.match(systemPrompt, /TTS.*first assistant action/i);
  assert.match(systemPrompt, /before any Live2D, search, capture, other tool call, or final text/i);
  assert.match(systemPrompt, /brief acknowledgement first when more tools or research are required/i);
});

test('TC-PI-028 forced voice mode requires TTS before every other action', async () => {
  const { systemPrompt } = await buildPrompt({
    sessionId: 'voice-force-first',
    input: '继续',
    runtimeContext: {
      permission_level: 'medium',
      voice_auto_reply_enabled: true,
      voice_auto_reply_mode: 'force_on',
      input_type: 'text'
    }
  });
  assert.match(systemPrompt, /TTS tool call MUST be the first assistant action/i);
  assert.match(systemPrompt, /before any Live2D, search, capture, or other tool call/i);
});
