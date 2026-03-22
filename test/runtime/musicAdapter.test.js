const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { __internal } = require('../../apps/runtime/tooling/adapters/music');

test('music adapter resolves workspace-relative play paths and forwards control methods', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-adapter-'));
  const musicPath = path.join(tmpDir, 'tracks', 'demo.mp3');
  await fs.mkdir(path.dirname(musicPath), { recursive: true });
  await fs.writeFile(musicPath, 'stub-audio', 'utf8');

  const calls = [];
  const adapters = __internal.createMusicAdapters({
    invokeRpc: async ({ method, params }) => {
      calls.push({ method, params });
      return { ok: true, method };
    }
  });

  const playResult = await adapters['desktop.music.play']({
    path: 'tracks/demo.mp3',
    volume: 0.25,
    loop: true,
    trackLabel: 'Demo Track'
  }, {
    workspaceRoot: tmpDir,
    trace_id: 'trace-1'
  });
  const pauseResult = await adapters['desktop.music.pause']({}, { trace_id: 'trace-2' });
  const resumeResult = await adapters['desktop.music.resume']({}, { trace_id: 'trace-3' });
  const stopResult = await adapters['desktop.music.stop']({}, { trace_id: 'trace-4' });
  const stateResult = await adapters['desktop.music.state.get']({}, { trace_id: 'trace-5' });

  assert.equal(playResult, JSON.stringify({ ok: true, method: 'desktop.music.play' }));
  assert.equal(pauseResult, JSON.stringify({ ok: true, method: 'desktop.music.pause' }));
  assert.equal(resumeResult, JSON.stringify({ ok: true, method: 'desktop.music.resume' }));
  assert.equal(stopResult, JSON.stringify({ ok: true, method: 'desktop.music.stop' }));
  assert.equal(stateResult, JSON.stringify({ ok: true, method: 'desktop.music.state.get' }));

  assert.deepEqual(calls[0], {
    method: 'desktop.music.play',
    params: {
      path: musicPath,
      volume: 0.25,
      loop: true,
      trackLabel: 'Demo Track'
    }
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[1].method, 'desktop.music.pause');
  assert.equal(calls[2].method, 'desktop.music.resume');
  assert.equal(calls[3].method, 'desktop.music.stop');
  assert.equal(calls[4].method, 'desktop.music.state.get');
});

test('music adapter rejects paths that escape the workspace or use unsupported extensions', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-adapter-paths-'));
  await fs.writeFile(path.join(tmpDir, 'demo.txt'), 'not-music', 'utf8');

  const adapters = __internal.createMusicAdapters({
    invokeRpc: async () => ({ ok: true })
  });

  await assert.rejects(
    () => adapters['desktop.music.play']({ path: '../escape.mp3' }, { workspaceRoot: tmpDir }),
    (err) => err.code === 'PERMISSION_DENIED'
  );

  await assert.rejects(
    () => adapters['desktop.music.play']({ path: 'demo.txt' }, { workspaceRoot: tmpDir }),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});
