const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRpcRequest } = require('../../apps/desktop-live2d/main/rpcValidator');

test('validateRpcRequest accepts V1 methods with valid params', () => {
  const input = {
    jsonrpc: '2.0',
    id: '1',
    method: 'chat.show',
    params: { text: 'hello', durationMs: 1200 }
  };

  const result = validateRpcRequest(input);
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'chat.show');
});

test('validateRpcRequest accepts chat panel append payload', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'panel-1',
    method: 'chat.panel.append',
    params: {
      role: 'assistant',
      text: 'new message',
      timestamp: 1730000000000
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'chat.panel.append');
});

test('validateRpcRequest accepts tool.invoke payload', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'tool-1',
    method: 'tool.invoke',
    params: {
      name: 'desktop_model_set_param',
      arguments: { name: 'ParamAngleX', value: 1.5 }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'tool.invoke');
});

test('validateRpcRequest accepts desktop perception and capture payloads', () => {
  const capabilities = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'capability-1',
    method: 'desktop.perception.capabilities',
    params: {}
  });
  const displaysList = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'display-1',
    method: 'desktop.perception.displays.list',
    params: {}
  });
  const regionCapture = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'capture-1',
    method: 'desktop.capture.region',
    params: {
      display_id: 'display:2',
      x: 10,
      y: 20,
      width: 200,
      height: 100
    }
  });

  assert.equal(capabilities.ok, true);
  assert.equal(displaysList.ok, true);
  assert.equal(regionCapture.ok, true);
  assert.equal(regionCapture.request.method, 'desktop.capture.region');
});

test('validateRpcRequest accepts debug.mouthOverride.set payload', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'mouth-1',
    method: 'debug.mouthOverride.set',
    params: {
      enabled: true,
      mouthOpen: 0.48,
      mouthForm: -0.32
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'debug.mouthOverride.set');
});

test('validateRpcRequest rejects non-whitelisted method', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'x',
    method: 'motion.play',
    params: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, -32601);
});

test('validateRpcRequest rejects invalid param types', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 9,
    method: 'param.set',
    params: { name: 'ParamAngleX', value: 'not-number' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, -32602);
});

test('validateRpcRequest rejects desktop.capture.get without capture id', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'cap-get',
    method: 'desktop.capture.get',
    params: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, -32602);
});

test('validateRpcRequest rejects unknown role in chat.panel.append', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'bad-role',
    method: 'chat.panel.append',
    params: { role: 'invalid', text: 'hello' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, -32602);
});

test('validateRpcRequest rejects invalid model.param.batchSet payload', () => {
  const result = validateRpcRequest({
    jsonrpc: '2.0',
    id: 'batch-bad',
    method: 'model.param.batchSet',
    params: {
      updates: [
        { name: 'ParamAngleX', value: 1 },
        { name: '', value: 2 }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, -32602);
});
