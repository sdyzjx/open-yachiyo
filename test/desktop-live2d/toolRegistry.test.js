const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listDesktopTools,
  resolveToolInvoke
} = require('../../apps/desktop-live2d/main/toolRegistry');

test('listDesktopTools returns non-empty tool definitions', () => {
  const tools = listDesktopTools();
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length >= 10);
  assert.ok(tools.some((item) => item.name === 'desktop_model_set_param'));
  assert.ok(tools.some((item) => item.name === 'desktop_perception_capabilities'));
  assert.ok(tools.some((item) => item.name === 'desktop_capture_desktop'));
  assert.ok(tools.some((item) => item.name === 'desktop_capture_screen'));
  assert.ok(tools.some((item) => item.name === 'desktop_windows_list'));
  assert.ok(tools.some((item) => item.name === 'desktop_capture_window'));
});

test('resolveToolInvoke maps tool name to rpc method and args', () => {
  const resolved = resolveToolInvoke({
    name: 'desktop_model_set_param',
    args: { name: 'ParamAngleX', value: 10 }
  });

  assert.equal(resolved.method, 'model.param.set');
  assert.equal(resolved.toolName, 'desktop_model_set_param');
  assert.deepEqual(resolved.params, { name: 'ParamAngleX', value: 10 });
});

test('resolveToolInvoke maps local desktop perception tools', () => {
  const resolved = resolveToolInvoke({
    name: 'desktop_capture_region',
    args: { x: 0, y: 0, width: 320, height: 240 }
  });

  assert.equal(resolved.method, 'desktop.capture.region');
  assert.deepEqual(resolved.params, { x: 0, y: 0, width: 320, height: 240 });
});

test('resolveToolInvoke maps desktop capture tool', () => {
  const resolved = resolveToolInvoke({
    name: 'desktop_capture_desktop',
    args: {}
  });

  assert.equal(resolved.method, 'desktop.capture.desktop');
  assert.deepEqual(resolved.params, {});
});

test('resolveToolInvoke maps window capture tool', () => {
  const resolved = resolveToolInvoke({
    name: 'desktop_capture_window',
    args: { source_id: 'window:42:0' }
  });

  assert.equal(resolved.method, 'desktop.capture.window');
  assert.deepEqual(resolved.params, { source_id: 'window:42:0' });
});

test('resolveToolInvoke maps desktop perception capabilities tool', () => {
  const resolved = resolveToolInvoke({
    name: 'desktop_perception_capabilities',
    args: {}
  });

  assert.equal(resolved.method, 'desktop.perception.capabilities');
  assert.deepEqual(resolved.params, {});
});

test('resolveToolInvoke rejects non-whitelisted tools', () => {
  assert.throws(
    () => resolveToolInvoke({ name: 'unsafe_tool' }),
    (err) => {
      assert.equal(err.code, -32006);
      return true;
    }
  );
});
