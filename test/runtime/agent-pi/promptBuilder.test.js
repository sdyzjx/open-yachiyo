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
    const stableContent = message.content.replace(
      'If shell.exec returns APPROVAL_REQUIRED, call shell.approve with approval_id, then retry shell.exec.',
      'Tool approvals and workspace boundaries are handled by the Pi policy extension. Never request, forge, or retry an approval token yourself.'
    );
    assert.ok(systemPrompt.includes(stableContent), `Missing paragraph: ${stableContent}`);
  }
  assert.match(systemPrompt, /Session permission level: high/);
  assert.doesNotMatch(systemPrompt, /call shell\.approve/i);
  assert.match(systemPrompt, /handled by the Pi policy extension/i);
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

test('TC-PI-045 Realtime native speech and explicit chat delivery stay independent', async () => {
  const { systemPrompt } = await buildPrompt({
    sessionId: 'native-delivery',
    input: '给我一个建议',
    runtimeContext: {
      permission_level: 'high',
      voice_auto_reply_enabled: true,
      voice_auto_reply_mode: 'policy',
      native_voice_available: true,
      explicit_ui_delivery: true,
      input_type: 'text'
    }
  });
  assert.match(systemPrompt, /Prefer ui\.chat\.post whenever.*user-visible text/i);
  assert.match(systemPrompt, /normal assistant response is spoken/i);
  assert.match(systemPrompt, /text-only reply, call ui\.chat\.post/i);
  assert.match(systemPrompt, /Never call voice\.tts_aliyun_vc/i);
});

test('TC-PI-046 prompt forbids ending with an unexecuted action promise', async () => {
  const { systemPrompt } = await buildPrompt({
    sessionId: 'tool-obligation', input: '查看电脑网卡', runtimeContext: { permission_level: 'high' }
  });
  assert.match(systemPrompt, /Never end the turn with only a promise/i);
  assert.match(systemPrompt, /call the relevant tool in the same turn/i);
});

test('TC-PI-048 prompt requires user feedback before and after tool work', async () => {
  const { systemPrompt } = await buildPrompt({
    sessionId: 'interaction-first', input: '帮我检查一下', runtimeContext: { permission_level: 'high', explicit_ui_delivery: true }
  });
  assert.match(systemPrompt, /User interaction has the highest priority/i);
  assert.match(systemPrompt, /Before using tools, give the user a concise direct answer or acknowledgement/i);
  assert.match(systemPrompt, /After tools finish, explain what you actually did/i);
  assert.match(systemPrompt, /spoken acknowledgement your first action/i);
});
