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
