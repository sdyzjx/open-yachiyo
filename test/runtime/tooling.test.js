const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');

const { ToolConfigStore } = require('../../apps/runtime/tooling/toolConfigStore');
const { ToolRegistry } = require('../../apps/runtime/tooling/toolRegistry');
const { ToolExecutor } = require('../../apps/runtime/executor/toolExecutor');

function buildExecutor() {
  const store = new ToolConfigStore({ configPath: path.resolve(process.cwd(), 'config/tools.yaml') });
  const config = store.load();
  const registry = new ToolRegistry({ config });
  return new ToolExecutor(registry, { policy: config.policy, exec: config.exec });
}

test('ToolConfigStore loads yaml and validates structure', () => {
  const store = new ToolConfigStore({ configPath: path.resolve(process.cwd(), 'config/tools.yaml') });
  const cfg = store.load();
  assert.equal(Array.isArray(cfg.tools), true);
  assert.ok(cfg.tools.some((t) => t.name === 'workspace.write_file'));
  assert.ok(cfg.tools.some((t) => t.name === 'live2d.motion.play'));
  assert.ok(cfg.tools.some((t) => t.name === 'live2d.react'));
});

test('ToolRegistry keeps scheduling metadata from config', () => {
  const store = new ToolConfigStore({ configPath: path.resolve(process.cwd(), 'config/tools.yaml') });
  const config = store.load();
  const registry = new ToolRegistry({ config });
  const tools = registry.list();

  const getTime = tools.find((tool) => tool.name === 'get_time');
  const live2dGesture = tools.find((tool) => tool.name === 'live2d.gesture');

  assert.equal(getTime?.side_effect_level, 'none');
  assert.equal(Boolean(live2dGesture?.requires_lock), true);
});

test('voice.tts_aliyun_vc schema tolerates durationSec aliases', () => {
  const store = new ToolConfigStore({ configPath: path.resolve(process.cwd(), 'config/tools.yaml') });
  const config = store.load();
  const voiceTool = config.tools.find((tool) => tool.name === 'voice.tts_aliyun_vc');
  assert.ok(voiceTool?.input_schema);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(voiceTool.input_schema);

  assert.equal(validate({ text: 'hello', voiceTag: 'zh', durationSec: '8' }), true, JSON.stringify(validate.errors || []));
  assert.equal(validate({ text: 'hello', voiceTag: 'zh', duration_sec: 8 }), true, JSON.stringify(validate.errors || []));
});

test('ToolExecutor rejects invalid args by schema', async () => {
  const executor = buildExecutor();
  const result = await executor.execute({ name: 'add', args: { a: 'x', b: 1 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_ERROR');
});

test('ToolExecutor rejects unsupported live2d semantic args by schema', async () => {
  const executor = buildExecutor();

  const invalidEmoteEmotion = await executor.execute({
    name: 'live2d.emote',
    args: { emotion: 'smile', intensity: 'medium', duration_sec: 1.2 }
  });
  assert.equal(invalidEmoteEmotion.ok, false);
  assert.equal(invalidEmoteEmotion.code, 'VALIDATION_ERROR');

  const invalidEmoteIntensity = await executor.execute({
    name: 'live2d.emote',
    args: { emotion: 'sad', intensity: 'high', duration_sec: 1.2 }
  });
  assert.equal(invalidEmoteIntensity.ok, false);
  assert.equal(invalidEmoteIntensity.code, 'VALIDATION_ERROR');

  const invalidGesture = await executor.execute({
    name: 'live2d.gesture',
    args: { type: 'wave', duration_sec: 1.2 }
  });
  assert.equal(invalidGesture.ok, false);
  assert.equal(invalidGesture.code, 'VALIDATION_ERROR');

  const invalidReact = await executor.execute({
    name: 'live2d.react',
    args: { intent: 'meltdown', duration_sec: 1.2 }
  });
  assert.equal(invalidReact.ok, false);
  assert.equal(invalidReact.code, 'VALIDATION_ERROR');

  const invalidExpression = await executor.execute({
    name: 'live2d.expression.set',
    args: { name: 'laugh', duration_sec: 1.2 }
  });
  assert.equal(invalidExpression.ok, false);
  assert.equal(invalidExpression.code, 'VALIDATION_ERROR');

  const invalidMotion = await executor.execute({
    name: 'live2d.motion.play',
    args: { group: 'Walk', index: 0, duration_sec: 1.2 }
  });
  assert.equal(invalidMotion.ok, false);
  assert.equal(invalidMotion.code, 'VALIDATION_ERROR');
});

test('ToolExecutor accepts extended live2d semantic presets in event mode', async () => {
  const executor = buildExecutor();
  const published = [];
  const context = {
    session_id: 's-live2d-extended',
    trace_id: 'trace-live2d-extended',
    publishEvent: (topic, payload) => {
      published.push({ topic, payload });
    }
  };

  const emoteResult = await executor.execute({
    name: 'live2d.emote',
    args: {
      emotion: 'shy',
      intensity: 'medium',
      duration_sec: 2.1,
      queue_policy: 'replace'
    }
  }, context);
  assert.equal(emoteResult.ok, true);

  const gestureResult = await executor.execute({
    name: 'live2d.gesture',
    args: {
      type: 'apologize',
      duration_sec: 2.4,
      queue_policy: 'append'
    }
  }, context);
  assert.equal(gestureResult.ok, true);

  const reactResult = await executor.execute({
    name: 'live2d.react',
    args: {
      intent: 'panic',
      duration_sec: 2.6,
      queue_policy: 'append'
    }
  }, context);
  assert.equal(reactResult.ok, true);

  const topics = published.map((item) => item.topic);
  assert.ok(topics.includes('ui.live2d.action'));
});

test('workspace.write_file writes under workspace', async () => {
  const executor = buildExecutor();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tooling-ws-'));

  const result = await executor.execute(
    {
      name: 'workspace.write_file',
      args: { path: 'notes/a.txt', content: 'hello', mode: 'overwrite' }
    },
    { workspaceRoot: tmp }
  );

  assert.equal(result.ok, true);
  const out = await fs.readFile(path.join(tmp, 'notes/a.txt'), 'utf8');
  assert.equal(out, 'hello');
});

test('workspace.write_file denies path escaping workspace', async () => {
  const executor = buildExecutor();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tooling-ws-'));

  const result = await executor.execute(
    {
      name: 'workspace.write_file',
      args: { path: '../evil.txt', content: 'x' }
    },
    { workspaceRoot: tmp }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PERMISSION_DENIED');
});

test('shell.exec allowlist works', async () => {
  const executor = buildExecutor();
  const ok = await executor.execute({ name: 'shell.exec', args: { command: 'echo hello' } });
  assert.equal(ok.ok, true);
  assert.match(ok.result, /hello/);

  const denied = await executor.execute({ name: 'shell.exec', args: { command: 'whoami' } });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'PERMISSION_DENIED');
});

test('memory tools are permission-gated by session permission level', async () => {
  const executor = buildExecutor();

  const lowSearch = await executor.execute(
    { name: 'memory_search', args: { query: 'any', limit: 3 } },
    { permission_level: 'low' }
  );
  assert.equal(lowSearch.ok, false);
  assert.equal(lowSearch.code, 'PERMISSION_DENIED');

  const mediumWrite = await executor.execute(
    { name: 'memory_write', args: { content: 'should be denied', keywords: ['deny'] } },
    { permission_level: 'medium' }
  );
  assert.equal(mediumWrite.ok, false);
  assert.equal(mediumWrite.code, 'PERMISSION_DENIED');

  const mediumSearch = await executor.execute(
    { name: 'memory_search', args: { query: 'any', limit: 3 } },
    { permission_level: 'medium' }
  );
  assert.equal(mediumSearch.ok, true);
});

test('shell.exec applies low/medium/high permission profiles', async () => {
  const executor = buildExecutor();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tooling-shell-perm-'));

  const lowDenied = await executor.execute(
    { name: 'shell.exec', args: { command: 'curl --version' } },
    { permission_level: 'low', workspaceRoot: tmp }
  );
  assert.equal(lowDenied.ok, false);
  assert.equal(lowDenied.code, 'PERMISSION_DENIED');

  const mediumAllowed = await executor.execute(
    { name: 'shell.exec', args: { command: 'curl --version' } },
    { permission_level: 'medium', workspaceRoot: tmp }
  );
  assert.equal(mediumAllowed.ok, true);
  assert.match(mediumAllowed.result, /curl/i);

  const highAllowed = await executor.execute(
    { name: 'shell.exec', args: { command: 'whoami' } },
    { permission_level: 'high', workspaceRoot: tmp }
  );
  assert.equal(highAllowed.ok, true);

  const highWriteOutsideDenied = await executor.execute(
    { name: 'shell.exec', args: { command: 'touch /tmp/yachiyo-should-not-write' } },
    { permission_level: 'high', workspaceRoot: tmp }
  );
  assert.equal(highWriteOutsideDenied.ok, false);
  assert.equal(highWriteOutsideDenied.code, 'PERMISSION_DENIED');

  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tooling-shell-ext-'));
  const externalSrc = path.join(externalDir, 'external.txt');
  await fs.writeFile(externalSrc, 'external-content', 'utf8');

  const highCopyIntoWorkspace = await executor.execute(
    {
      name: 'shell.exec',
      args: { command: `cp ${externalSrc} imported.txt` }
    },
    { permission_level: 'high', workspaceRoot: tmp }
  );
  assert.equal(highCopyIntoWorkspace.ok, true);
  const imported = await fs.readFile(path.join(tmp, 'imported.txt'), 'utf8');
  assert.equal(imported, 'external-content');

  const highCopyOutsideWorkspaceDenied = await executor.execute(
    {
      name: 'shell.exec',
      args: { command: `cp imported.txt ${path.join(externalDir, 'copied-back.txt')}` }
    },
    { permission_level: 'high', workspaceRoot: tmp }
  );
  assert.equal(highCopyOutsideWorkspaceDenied.ok, false);
  assert.equal(highCopyOutsideWorkspaceDenied.code, 'PERMISSION_DENIED');

  const mediumReadOutsideWorkspaceDenied = await executor.execute(
    { name: 'shell.exec', args: { command: `cat ${externalSrc}` } },
    { permission_level: 'medium', workspaceRoot: tmp }
  );
  assert.equal(mediumReadOutsideWorkspaceDenied.ok, false);
  assert.equal(mediumReadOutsideWorkspaceDenied.code, 'PERMISSION_DENIED');
});

test('persona.update_profile is callable at low permission and updates via curl', async () => {
  const reqBodies = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'PUT' && req.url === '/api/persona/profile') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        reqBodies.push(JSON.parse(raw || '{}'));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, data: { addressing: { custom_name: '小主人' } } }));
      });
      return;
    }
    res.writeHead(404).end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const previousBase = process.env.PERSONA_API_BASE_URL;
  process.env.PERSONA_API_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const executor = buildExecutor();
    const result = await executor.execute(
      { name: 'persona.update_profile', args: { custom_name: '小主人' } },
      { permission_level: 'low' }
    );

    assert.equal(result.ok, true);
    assert.equal(reqBodies.length, 1);
    assert.equal(reqBodies[0].profile.addressing.custom_name, '小主人');
  } finally {
    if (previousBase) process.env.PERSONA_API_BASE_URL = previousBase;
    else delete process.env.PERSONA_API_BASE_URL;
    server.close();
  }
});
