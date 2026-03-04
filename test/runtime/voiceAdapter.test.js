const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const voiceAdapters = require('../../apps/runtime/tooling/adapters/voice');

const previousVoicePathMode = process.env.VOICE_PATH_MODE;
process.env.VOICE_PATH_MODE = 'runtime_legacy';

test('voice adapter enforces model/voice compatibility', () => {
  assert.throws(
    () => {
      voiceAdapters.__internal.checkModelVoiceCompatibility({
        model: 'qwen3-tts-vc-2026-01-22',
        voiceId: 'voice-A',
        registry: {
          'voice-A': {
            targetModel: 'qwen3-tts-vc-realtime-2026-01-15'
          }
        }
      });
    },
    (err) => err && err.code === 'TTS_MODEL_VOICE_MISMATCH'
  );
});

test('voice adapter applies cooldown and per-minute rate limit', () => {
  const { cooldownStore, enforceRateLimit } = voiceAdapters.__internal;
  cooldownStore.calls.clear();

  const policy = {
    limits: {
      cooldown_sec_per_session: 20,
      max_tts_calls_per_minute: 2
    }
  };

  enforceRateLimit({ sessionId: 's1', nowMs: 1_000, policy });
  cooldownStore.addCall('s1', 1_000);

  assert.throws(
    () => enforceRateLimit({ sessionId: 's1', nowMs: 5_000, policy }),
    (err) => err && err.code === 'TTS_POLICY_REJECTED'
  );

  enforceRateLimit({ sessionId: 's1', nowMs: 22_000, policy });
  cooldownStore.addCall('s1', 22_000);

  assert.throws(
    () => enforceRateLimit({ sessionId: 's1', nowMs: 43_000, policy }),
    (err) => err && err.code === 'TTS_RATE_LIMITED'
  );
});

test('voice adapter executes configured CLI and returns success payload', async () => {
  const { ttsAliyunVc, cooldownStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-cli-'));
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\necho "/tmp/mock-audio.ogg"\n', { mode: 0o755 });

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    const resultJson = await ttsAliyunVc(
      {
        text: '这是一个短回复',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'zh',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-1',
        voiceRegistry: {
          'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' }
        }
      }
    );

    const result = JSON.parse(resultJson);
    assert.equal(result.status, 'success');
    assert.equal(typeof result.message, 'string');
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter emits policy and job events via publishEvent', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-cli-events-'));
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\necho "/tmp/mock-event-audio.ogg"\n', { mode: 0o755 });

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  const events = [];

  try {
    await ttsAliyunVc(
      {
        text: '继续推进下一步',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'zh',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-events',
        voiceRegistry: {
          'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' }
        },
        publishEvent: (topic, payload) => events.push({ topic, payload })
      }
    );

    const topics = events.map((e) => e.topic);
    assert.equal(topics.includes('voice.policy.checked'), true);
    assert.equal(topics.includes('voice.job.started'), true);
    assert.equal(topics.includes('voice.job.completed'), true);
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter deduplicates same idempotencyKey and avoids duplicate cli calls', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-idempotency-'));
  const counter = path.join(tmp, 'counter.txt');
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash\ncount=0\nif [ -f "${counter}" ]; then count=$(cat "${counter}"); fi\ncount=$((count+1))\necho $count > "${counter}"\necho "/tmp/mock-idem-$count.ogg"\n`,
    { mode: 0o755 }
  );

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    const args = {
      text: '去重测试',
      voiceId: 'voice-A',
      model: 'qwen3-tts-vc-2026-01-22',
      voiceTag: 'zh',
      turnId: 'turn-1',
      idempotencyKey: 'sess1-turn1-voice',
      replyMeta: { inputType: 'audio', sentenceCount: 1 }
    };

    const context = {
      session_id: 'session-idem',
      voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } }
    };

    const first = JSON.parse(await ttsAliyunVc(args, context));
    const second = JSON.parse(await ttsAliyunVc(args, context));

    assert.equal(first.status, 'success');
    assert.equal(typeof second.audioRef, 'string');

    const countRaw = await fs.readFile(counter, 'utf8');
    assert.equal(Number(countRaw.trim()), 1);
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter cancels stale job when superseded by newer request', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore, activeJobStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();
  activeJobStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-cancel-'));
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(
    script,
    '#!/usr/bin/env bash\nif [ "$7" = "slow" ]; then sleep 1; fi\necho "/tmp/mock-cancel-$7.ogg"\n',
    { mode: 0o755 }
  );

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    const base = {
      voiceId: 'voice-A',
      model: 'qwen3-tts-vc-2026-01-22',
      voiceTag: 'zh',
      replyMeta: { inputType: 'audio', sentenceCount: 1 }
    };
    const ctx = {
      session_id: 'session-cancel',
      voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } }
    };

    const slowPromise = ttsAliyunVc({ ...base, text: 'slow' }, ctx);
    slowPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    const fastResult = JSON.parse(await ttsAliyunVc({ ...base, text: 'fast' }, ctx));

    assert.equal(fastResult.status, 'success');

    await assert.rejects(
      async () => {
        await slowPromise;
      },
      (err) => err && err.code === 'TTS_CANCELLED'
    );
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter retries once on provider error then succeeds', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore, activeJobStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();
  activeJobStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-retry-'));
  const marker = path.join(tmp, 'attempt.txt');
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash\nif [ ! -f "${marker}" ]; then echo 1 > "${marker}"; echo "first fail" 1>&2; exit 1; fi\necho "/tmp/mock-retry-ok.ogg"\n`,
    { mode: 0o755 }
  );

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    const result = JSON.parse(await ttsAliyunVc(
      {
        text: 'retry test',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'zh',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-retry',
        voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } }
      }
    ));

    assert.equal(result.status, 'success');
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter maps timeout to TTS_TIMEOUT without retrying', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore, activeJobStore } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();
  activeJobStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-timeout-'));
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\nsleep 2\necho "/tmp/never.ogg"\n', { mode: 0o755 });

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    await assert.rejects(
      () => ttsAliyunVc(
        {
          text: 'timeout test',
          voiceId: 'voice-A',
          model: 'qwen3-tts-vc-2026-01-22',
          voiceTag: 'zh',
          timeoutSec: 1,
          replyMeta: { inputType: 'audio', sentenceCount: 1 }
        },
        {
          session_id: 'session-timeout',
          voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } }
        }
      ),
      (err) => err && err.code === 'TTS_TIMEOUT'
    );
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice stats reports aggregated counters', async () => {
  const {
    ttsAliyunVc,
    voiceStats,
    resetMetrics,
    cooldownStore,
    idempotencyStore,
    activeJobStore
  } = voiceAdapters.__internal;

  resetMetrics();
  cooldownStore.calls.clear();
  idempotencyStore.clear();
  activeJobStore.clear();

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-stats-'));
  const script = path.join(tmp, 'mock-voice-reply.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\necho "/tmp/mock-stats.ogg"\n', { mode: 0o755 });

  const previousCli = process.env.VOICE_REPLY_CLI;
  process.env.VOICE_REPLY_CLI = script;

  try {
    await ttsAliyunVc(
      {
        text: 'stats ok',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'zh',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-stats',
        voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } }
      }
    );

    const stats = JSON.parse(await voiceStats());
    assert.equal(stats.tts_total >= 1, true);
    assert.equal(stats.tts_success >= 1, true);
    assert.equal(typeof stats.updated_at, 'string');
  } finally {
    if (previousCli) process.env.VOICE_REPLY_CLI = previousCli;
    else delete process.env.VOICE_REPLY_CLI;
  }
});

test('voice adapter chooses electron_native mode and returns accepted payload', async () => {
  const { ttsAliyunVc, cooldownStore, idempotencyStore, loadVoicePathMode } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();

  const prevMode = process.env.VOICE_PATH_MODE;
  process.env.VOICE_PATH_MODE = 'electron_native';
  assert.equal(loadVoicePathMode(), 'electron_native');

  const events = [];
  try {
    const result = JSON.parse(await ttsAliyunVc(
      {
        text: 'electron route',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'zh',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-electron-route',
        voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } },
        publishEvent: (topic, payload) => events.push({ topic, payload })
      }
    ));

    assert.equal(result.status, 'accepted');
    assert.equal(result.route, 'electron_native');
    assert.equal(events.some((item) => item.topic === 'voice.requested'), true);
  } finally {
    if (prevMode !== undefined) process.env.VOICE_PATH_MODE = prevMode;
    else delete process.env.VOICE_PATH_MODE;
  }
});

test('voice adapter normalizes jp tts text before dispatching electron_native request', async () => {
  const {
    ttsAliyunVc,
    cooldownStore,
    idempotencyStore,
    loadVoicePathMode,
    normalizeTtsInputText
  } = voiceAdapters.__internal;
  cooldownStore.calls.clear();
  idempotencyStore.clear();

  assert.equal(normalizeTtsInputText('八千代、おはよう', 'jp'), 'やちよ、おはよう');
  assert.equal(normalizeTtsInputText('八千代，早上好', 'zh'), '八千代，早上好');

  const prevMode = process.env.VOICE_PATH_MODE;
  process.env.VOICE_PATH_MODE = 'electron_native';
  assert.equal(loadVoicePathMode(), 'electron_native');

  const events = [];
  try {
    await ttsAliyunVc(
      {
        text: '八千代、おはよう',
        voiceId: 'voice-A',
        model: 'qwen3-tts-vc-2026-01-22',
        voiceTag: 'jp',
        replyMeta: { inputType: 'audio', sentenceCount: 1 }
      },
      {
        session_id: 'session-electron-jp-normalize',
        voiceRegistry: { 'voice-A': { targetModel: 'qwen3-tts-vc-2026-01-22' } },
        publishEvent: (topic, payload) => events.push({ topic, payload })
      }
    );

    const voiceRequested = events.find((item) => item.topic === 'voice.requested');
    assert.ok(voiceRequested);
    assert.equal(voiceRequested.payload.text, 'やちよ、おはよう');
  } finally {
    if (prevMode !== undefined) process.env.VOICE_PATH_MODE = prevMode;
    else delete process.env.VOICE_PATH_MODE;
  }
});

test('voice adapter reads runtime desktop config with comments for electron_native mode', async () => {
  const { loadVoicePathMode, resolveDesktopLive2dConfigPath } = voiceAdapters.__internal;
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-home-'));
  const configDir = path.join(tmpHome, 'config');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'desktop-live2d.json'),
    `{
  // runtime desktop config
  "voice": {
    "path": "electron_native"
  }
}
`,
    'utf8'
  );

  const prevMode = process.env.VOICE_PATH_MODE;
  const prevHome = process.env.YACHIYO_HOME;
  const prevConfigPath = process.env.DESKTOP_LIVE2D_CONFIG_PATH;
  delete process.env.VOICE_PATH_MODE;
  process.env.YACHIYO_HOME = tmpHome;
  delete process.env.DESKTOP_LIVE2D_CONFIG_PATH;

  try {
    assert.equal(resolveDesktopLive2dConfigPath(), path.join(configDir, 'desktop-live2d.json'));
    assert.equal(loadVoicePathMode(), 'electron_native');
  } finally {
    if (prevMode !== undefined) process.env.VOICE_PATH_MODE = prevMode;
    else delete process.env.VOICE_PATH_MODE;
    if (prevHome !== undefined) process.env.YACHIYO_HOME = prevHome;
    else delete process.env.YACHIYO_HOME;
    if (prevConfigPath !== undefined) process.env.DESKTOP_LIVE2D_CONFIG_PATH = prevConfigPath;
    else delete process.env.DESKTOP_LIVE2D_CONFIG_PATH;
  }
});

test.after(() => {
  if (previousVoicePathMode !== undefined) process.env.VOICE_PATH_MODE = previousVoicePathMode;
  else delete process.env.VOICE_PATH_MODE;
});
