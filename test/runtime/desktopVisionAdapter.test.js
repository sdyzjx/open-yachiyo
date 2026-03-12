const test = require('node:test');
const assert = require('node:assert/strict');

const desktopVisionAdapters = require('../../apps/runtime/tooling/adapters/desktopVision');

const {
  buildInspectMessages,
  normalizePrompt,
  normalizeCaptureRecord,
  readCaptureAsDataUrl,
  normalizeCaptureLookupArgs,
  normalizeInspectError,
  createDesktopVisionAdapters
} = desktopVisionAdapters.__internal;

test('desktop vision normalizePrompt requires non-empty prompt', () => {
  assert.equal(normalizePrompt('  inspect this  '), 'inspect this');
  assert.throws(() => normalizePrompt('   '), /non-empty prompt/i);
});

test('desktop vision normalizeCaptureRecord validates required fields', () => {
  const record = normalizeCaptureRecord({
    capture_id: 'cap_1',
    path: '/tmp/cap_1.png',
    mime_type: 'image/png',
    display_id: 'display:1',
    display_ids: ['display:1', 'display:2'],
    source_id: 'window:42:0',
    window_title: 'Browser'
  });
  assert.equal(record.capture_id, 'cap_1');
  assert.equal(record.path, '/tmp/cap_1.png');
  assert.deepEqual(record.display_ids, ['display:1', 'display:2']);
  assert.equal(record.source_id, 'window:42:0');
  assert.equal(record.window_title, 'Browser');
  assert.throws(() => normalizeCaptureRecord({ capture_id: 'cap_2' }), /incomplete/i);
});

test('desktop vision readCaptureAsDataUrl encodes capture file', () => {
  const fsModule = {
    existsSync: (filePath) => filePath === '/tmp/cap_1.png',
    readFileSync: () => Buffer.from('png-data')
  };
  const dataUrl = readCaptureAsDataUrl({
    capture_id: 'cap_1',
    path: '/tmp/cap_1.png',
    mime_type: 'image/png'
  }, { fsModule });

  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
});

test('desktop vision buildInspectMessages emits text and image parts', () => {
  const messages = buildInspectMessages({
    prompt: 'What is on the screen?',
    imageDataUrl: 'data:image/png;base64,abc'
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.deepEqual(messages[1].content[0], { type: 'text', text: 'What is on the screen?' });
  assert.deepEqual(messages[1].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,abc' }
  });
});

test('desktop vision normalizeInspectError wraps runtime errors with stage context', () => {
  const normalized = normalizeInspectError(new Error('boom'), {
    stage: 'analyze',
    captureId: 'cap_123'
  });
  assert.equal(normalized.code, 'RUNTIME_ERROR');
  assert.match(normalized.message, /desktop inspect failed during analyze/i);
  assert.equal(normalized.details.capture_id, 'cap_123');
});

test('desktop vision normalizeCaptureLookupArgs requires capture_id', () => {
  assert.deepEqual(normalizeCaptureLookupArgs({ captureId: 'cap_1' }), {
    capture_id: 'cap_1'
  });
  assert.throws(() => normalizeCaptureLookupArgs({}), /capture_id/i);
});

test('desktop inspect screen captures and performs multimodal subcall', async () => {
  const rpcCalls = [];
  const reasonerCalls = [];
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async ({ method, params, traceId }) => {
      rpcCalls.push({ method, params, traceId });
      return {
        capture_id: 'cap_screen_1',
        path: '/tmp/cap_screen_1.png',
        mime_type: 'image/png',
        display_id: 'display:2',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        pixel_size: { width: 2400, height: 1600 },
        scale_factor: 2
      };
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('screen-bytes')
    },
    getReasoner: () => ({
      decide: async ({ messages, tools }) => {
        reasonerCalls.push({ messages, tools });
        return { type: 'final', output: '发现一个登录弹窗。' };
      }
    })
  });

  const raw = await adapters['desktop.inspect.screen']({
    display_id: 'display:2',
    prompt: '这张截图里有什么？'
  }, {
    trace_id: 'trace-inspect-screen'
  });

  const result = JSON.parse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.capture_id, 'cap_screen_1');
  assert.equal(result.analysis, '发现一个登录弹窗。');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].method, 'desktop.capture.screen');
  assert.equal(rpcCalls[0].traceId, 'trace-inspect-screen');
  assert.equal(reasonerCalls.length, 1);
  assert.deepEqual(reasonerCalls[0].tools, []);
  assert.equal(reasonerCalls[0].messages[1].content[0].text, '这张截图里有什么？');
  assert.match(reasonerCalls[0].messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('desktop inspect desktop captures the virtual desktop and returns display metadata', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async ({ method, params }) => {
      assert.equal(method, 'desktop.capture.desktop');
      assert.deepEqual(params, {});
      return {
        capture_id: 'cap_desktop_1',
        path: '/tmp/cap_desktop_1.png',
        mime_type: 'image/png',
        display_ids: ['display:1', 'display:2'],
        bounds: { x: -1280, y: 0, width: 2792, height: 982 },
        pixel_size: { width: 2792, height: 982 },
        scale_factor: 1
      };
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('desktop-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'final', output: '左侧屏幕是编辑器，右侧屏幕是浏览器。' })
    })
  });

  const raw = await adapters['desktop.inspect.desktop']({
    prompt: '描述这个多显示器桌面。'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(result.capture_id, 'cap_desktop_1');
  assert.deepEqual(result.display_ids, ['display:1', 'display:2']);
  assert.equal(result.analysis, '左侧屏幕是编辑器，右侧屏幕是浏览器。');
});

test('desktop inspect capture reuses existing capture metadata without recapturing', async () => {
  const rpcCalls = [];
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async ({ method, params }) => {
      rpcCalls.push({ method, params });
      assert.equal(method, 'desktop.capture.get');
      assert.deepEqual(params, { capture_id: 'cap_existing_1' });
      return {
        capture_id: 'cap_existing_1',
        path: '/tmp/cap_existing_1.png',
        mime_type: 'image/png',
        display_ids: ['display:1', 'display:2'],
        bounds: { x: -1280, y: 0, width: 2792, height: 982 },
        pixel_size: { width: 2792, height: 982 },
        scale_factor: 1
      };
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('existing-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'final', output: '这张缓存截图包含左右两个工作区。' })
    })
  });

  const raw = await adapters['desktop.inspect.capture']({
    capture_id: 'cap_existing_1',
    prompt: '总结这张已有截图。'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(rpcCalls.length, 1);
  assert.equal(result.capture_id, 'cap_existing_1');
  assert.deepEqual(result.display_ids, ['display:1', 'display:2']);
  assert.equal(result.analysis, '这张缓存截图包含左右两个工作区。');
});

test('desktop inspect region forwards capture args and returns analysis payload', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async ({ method, params }) => {
      assert.equal(method, 'desktop.capture.region');
      assert.deepEqual(params, {
        x: 10,
        y: 20,
        width: 300,
        height: 160,
        display_id: 'display:1'
      });
      return {
        capture_id: 'cap_region_1',
        path: '/tmp/cap_region_1.png',
        mime_type: 'image/png',
        display_id: 'display:1',
        display_ids: ['display:1'],
        bounds: { x: 10, y: 20, width: 300, height: 160 },
        pixel_size: { width: 600, height: 320 },
        scale_factor: 2
      };
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('region-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'final', output: '按钮处于禁用状态。' })
    })
  });

  const raw = await adapters['desktop.inspect.region']({
    x: 10,
    y: 20,
    width: 300,
    height: 160,
    prompt: '按钮是什么状态？',
    display_id: 'display:1'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(result.capture_id, 'cap_region_1');
  assert.equal(result.analysis, '按钮处于禁用状态。');
  assert.deepEqual(result.display_ids, ['display:1']);
  assert.deepEqual(result.bounds, { x: 10, y: 20, width: 300, height: 160 });
});

test('desktop inspect region preserves multi-display capture metadata', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async () => ({
      capture_id: 'cap_region_multi',
      path: '/tmp/cap_region_multi.png',
      mime_type: 'image/png',
      display_ids: ['display:1', 'display:2'],
      bounds: { x: -100, y: 10, width: 200, height: 40 },
      pixel_size: { width: 200, height: 40 },
      scale_factor: 1
    }),
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('region-multi')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'final', output: '这个区域横跨左右两个显示器。' })
    })
  });

  const raw = await adapters['desktop.inspect.region']({
    x: -100,
    y: 10,
    width: 200,
    height: 40,
    prompt: '这个区域跨了几块屏幕？'
  }, {});

  const result = JSON.parse(raw);
  assert.deepEqual(result.display_ids, ['display:1', 'display:2']);
  assert.equal(result.analysis, '这个区域横跨左右两个显示器。');
});

test('desktop inspect window forwards selector args and returns window metadata', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async ({ method, params }) => {
      assert.equal(method, 'desktop.capture.window');
      assert.deepEqual(params, { source_id: 'window:42:0' });
      return {
        capture_id: 'cap_window_1',
        path: '/tmp/cap_window_1.png',
        mime_type: 'image/png',
        source_id: 'window:42:0',
        window_title: 'Browser',
        pixel_size: { width: 1280, height: 720 },
        scale_factor: 1
      };
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('window-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'final', output: '这是一个浏览器登录窗口。' })
    })
  });

  const raw = await adapters['desktop.inspect.window']({
    prompt: '这个窗口里是什么？',
    source_id: 'window:42:0'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(result.capture_id, 'cap_window_1');
  assert.equal(result.source_id, 'window:42:0');
  assert.equal(result.window_title, 'Browser');
  assert.equal(result.analysis, '这是一个浏览器登录窗口。');
});

test('desktop inspect surfaces runtime error when multimodal subcall returns tool decision', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async () => ({
      capture_id: 'cap_bad',
      path: '/tmp/cap_bad.png',
      mime_type: 'image/png'
    }),
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('region-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({ type: 'tool', tool: { name: 'echo', args: { text: 'x' } } })
    })
  });

  await assert.rejects(
    adapters['desktop.inspect.screen']({ prompt: '检查这个界面' }, {}),
    (err) => {
      assert.equal(err.code, 'RUNTIME_ERROR');
      assert.match(err.message, /tool decision unexpectedly/i);
      assert.equal(err.details.capture_id, 'cap_bad');
      assert.equal(err.details.stage, 'analyze');
      return true;
    }
  );
});

test('desktop inspect preserves capture-stage failure semantics', async () => {
  const adapters = createDesktopVisionAdapters({
    invokeRpc: async () => {
      throw new Error('rpc timeout');
    }
  });

  await assert.rejects(
    adapters['desktop.inspect.screen']({ prompt: '检查这个界面' }, {}),
    /desktop inspect failed during capture/i
  );
});
