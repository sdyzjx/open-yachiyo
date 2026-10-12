const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadVoicePolicy, evaluateVoicePolicy, defaultPolicy } = require('../../apps/runtime/tooling/voice/policy');

test('loadVoicePolicy parses auto_reply.enabled from yaml', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-policy-test-'));
  const policyPath = path.join(tmpDir, 'voice-policy.yaml');
  fs.writeFileSync(policyPath, [
    'voice_policy:',
    '  auto_reply:',
    '    enabled: true',
    '  limits:',
    '    max_chars: 180'
  ].join('\n'));

  const policy = loadVoicePolicy({ policyPath });
  assert.equal(policy.auto_reply.enabled, true);
  assert.equal(policy.limits.max_chars, 180);
});

test('voice policy allows short conversational content', () => {
  const policy = defaultPolicy();
  const result = evaluateVoicePolicy(
    {
      text: '晚上好，要不要我帮你整理今天的进度？',
      replyMeta: { inputType: 'text', sentenceCount: 1 }
    },
    {},
    policy
  );

  assert.equal(result.allow, true);
  assert.equal(result.code, 'OK');
});

test('TC-PI-028 voice policy recognizes pi input_type audio context', () => {
  const result = evaluateVoicePolicy(
    { text: '收到，我马上处理。', replyMeta: { sentenceCount: 1 } },
    { input_type: 'audio' },
    defaultPolicy()
  );
  assert.equal(result.allow, true);
  assert.equal(result.reason, 'must-speak matched');
  assert.equal(defaultPolicy().limits.cooldown_sec_per_session, 0.5);
  assert.equal(defaultPolicy().limits.max_tts_calls_per_minute, 12);
});

test('TC-PI-028 missing voice policy keeps conversational auto reply enabled', () => {
  const missingPolicyPath = path.join(os.tmpdir(), `missing-voice-policy-${Date.now()}.yaml`);
  const policy = loadVoicePolicy({ policyPath: missingPolicyPath });
  assert.equal(policy.auto_reply.enabled, true);
});

test('voice policy rejects code/troubleshooting content', () => {
  const policy = defaultPolicy();
  const result = evaluateVoicePolicy(
    {
      text: '请执行 npm test 并贴出日志',
      replyMeta: { sentenceCount: 1, containsCode: true, isTroubleshooting: true }
    },
    {},
    policy
  );

  assert.equal(result.allow, false);
  assert.equal(result.code, 'TTS_POLICY_REJECTED');
});

test('voice policy rejects too long text by max_chars', () => {
  const policy = defaultPolicy();
  const text = 'a'.repeat(260);
  const result = evaluateVoicePolicy(
    {
      text,
      replyMeta: { sentenceCount: 3 }
    },
    {},
    policy
  );

  assert.equal(result.allow, false);
  assert.equal(result.code, 'TTS_TEXT_TOO_LONG');
});
