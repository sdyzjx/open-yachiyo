const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function runNormalize(text, voiceTag) {
  return execFileSync(
    'python3',
    [
      '-c',
      [
        'from scripts.qwen_voice_reply import normalize_tts_input_text',
        'import sys',
        'print(normalize_tts_input_text(sys.argv[1], sys.argv[2]))'
      ].join('; '),
      text,
      voiceTag
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    }
  ).trim();
}

test('qwen voice reply normalizes 八千代 to やちよ for jp tts', () => {
  assert.equal(runNormalize('八千代、おはよう', 'jp'), 'やちよ、おはよう');
});

test('qwen voice reply keeps non-jp tts text unchanged', () => {
  assert.equal(runNormalize('八千代，早上好', 'zh'), '八千代，早上好');
  assert.equal(runNormalize('Hello 八千代', 'en'), 'Hello 八千代');
});
