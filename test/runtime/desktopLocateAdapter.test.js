const test = require('node:test');
const assert = require('node:assert/strict');

const desktopLocateAdapters = require('../../apps/runtime/tooling/adapters/desktopLocate');

const {
  normalizeTarget,
  normalizeTargetType,
  normalizeExpectedCount,
  buildLocateMessages,
  parseJsonObjectText,
  projectPixelBoundsToDesktopBounds,
  normalizeLocateMatch,
  createDesktopLocateAdapters
} = desktopLocateAdapters.__internal;

test('desktop locate normalizers enforce basic target contract', () => {
  assert.equal(normalizeTarget('  Open Yachiyo icon  '), 'Open Yachiyo icon');
  assert.equal(normalizeTargetType('Button'), 'button');
  assert.equal(normalizeTargetType(''), 'unknown');
  assert.equal(normalizeExpectedCount(0), 1);
  assert.equal(normalizeExpectedCount(8), 5);
  assert.throws(() => normalizeTarget('   '), /non-empty target/i);
});

test('desktop locate buildLocateMessages includes schema and image', () => {
  const messages = buildLocateMessages({
    target: 'Open Yachiyo icon',
    targetType: 'icon',
    expectedCount: 1,
    imageDataUrl: 'data:image/png;base64,abc',
    captureRecord: {
      display_id: '',
      bounds: { x: -1920, y: 0, width: 4480, height: 1440 },
      pixel_size: { width: 1280, height: 411 }
    }
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content[0].text, /Expected count: 1/);
  assert.match(messages[1].content[0].text, /Capture desktop bounds/);
  assert.equal(messages[1].content[1].image_url.url, 'data:image/png;base64,abc');
});

test('desktop locate parses fenced JSON and projects pixel bounds to desktop bounds', () => {
  const parsed = parseJsonObjectText('```json\n{"found":true,"matches":[]}\n```');
  assert.deepEqual(parsed, { found: true, matches: [] });
  assert.deepEqual(
    projectPixelBoundsToDesktopBounds(
      { x: 640, y: 205, width: 128, height: 41 },
      {
        bounds: { x: -1920, y: 0, width: 4480, height: 1440 },
        pixel_size: { width: 1280, height: 411 }
      }
    ),
    { x: 320, y: 718, width: 448, height: 144 }
  );
});

test('desktop locate normalizeLocateMatch resolves display-relative bounds when display contains result', () => {
  const match = normalizeLocateMatch(
    {
      label: 'Open Yachiyo',
      confidence: 0.92,
      pixel_bounds: { x: 120, y: 40, width: 80, height: 60 },
      reason: 'icon label matches'
    },
    {
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      pixel_size: { width: 1280, height: 720 }
    },
    [
      { id: 'display:2', bounds: { x: 0, y: 0, width: 2560, height: 1440 } }
    ]
  );

  assert.deepEqual(match.desktop_bounds, { x: 240, y: 80, width: 160, height: 120 });
  assert.equal(match.display_id, 'display:2');
  assert.deepEqual(match.display_relative_bounds, { x: 240, y: 80, width: 160, height: 120 });
});

test('desktop locate capture returns structured matches with desktop and display-relative bounds', async () => {
  const rpcCalls = [];
  const adapters = createDesktopLocateAdapters({
    invokeRpc: async ({ method, params }) => {
      rpcCalls.push({ method, params });
      if (method === 'desktop.capture.get') {
        return {
          capture_id: 'cap_existing_1',
          path: '/tmp/cap_existing_1.png',
          mime_type: 'image/png',
          display_id: '',
          display_ids: ['display:1', 'display:2'],
          bounds: { x: -1920, y: 0, width: 4480, height: 1440 },
          pixel_size: { width: 1280, height: 411 },
          scale_factor: 1
        };
      }
      if (method === 'desktop.perception.displays.list') {
        return {
          displays: [
            { id: 'display:1', bounds: { x: -1920, y: 360, width: 1920, height: 1080 } },
            { id: 'display:2', bounds: { x: 0, y: 0, width: 2560, height: 1440 } }
          ]
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('desktop-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({
        type: 'final',
        output: JSON.stringify({
          found: true,
          summary: 'Found the target icon on the right display.',
          matches: [
            {
              label: 'Open Yachiyo icon',
              confidence: 0.91,
              pixel_bounds: { x: 980, y: 32, width: 92, height: 74 },
              reason: 'Desktop icon and label are visible near the top-right area.'
            }
          ]
        })
      })
    })
  });

  const raw = await adapters['desktop.locate.capture']({
    capture_id: 'cap_existing_1',
    target: 'Open Yachiyo icon',
    target_type: 'icon'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].display_id, 'display:2');
  assert.deepEqual(result.matches[0].desktop_bounds, {
    x: 1510,
    y: 112,
    width: 322,
    height: 259
  });
  assert.deepEqual(result.matches[0].display_relative_bounds, {
    x: 1510,
    y: 112,
    width: 322,
    height: 259
  });
  assert.deepEqual(
    rpcCalls.map((entry) => entry.method),
    ['desktop.capture.get', 'desktop.perception.displays.list']
  );
});

test('desktop locate desktop captures and locates in one step', async () => {
  const adapters = createDesktopLocateAdapters({
    invokeRpc: async ({ method }) => {
      if (method === 'desktop.capture.desktop') {
        return {
          capture_id: 'cap_desktop_1',
          path: '/tmp/cap_desktop_1.png',
          mime_type: 'image/png',
          display_id: '',
          display_ids: ['display:1', 'display:2'],
          bounds: { x: -1920, y: 0, width: 4480, height: 1440 },
          pixel_size: { width: 1280, height: 411 },
          scale_factor: 1
        };
      }
      if (method === 'desktop.perception.displays.list') {
        return { displays: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    },
    fsModule: {
      existsSync: () => true,
      readFileSync: () => Buffer.from('desktop-bytes')
    },
    getReasoner: () => ({
      decide: async () => ({
        type: 'final',
        output: '{"found":false,"summary":"Target is not visible.","matches":[]}'
      })
    })
  });

  const raw = await adapters['desktop.locate.desktop']({
    target: 'Open Yachiyo icon',
    target_type: 'icon'
  }, {});

  const result = JSON.parse(raw);
  assert.equal(result.capture_id, 'cap_desktop_1');
  assert.equal(result.found, false);
  assert.deepEqual(result.matches, []);
});
