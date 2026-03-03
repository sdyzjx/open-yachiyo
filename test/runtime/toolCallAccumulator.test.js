const test = require('node:test');
const assert = require('node:assert/strict');

const { ToolCallAccumulator } = require('../../apps/runtime/llm/toolCallAccumulator');

test('ToolCallAccumulator emits delta/stable and resolves complete tool call', () => {
  const deltas = [];
  const stables = [];
  const accumulator = new ToolCallAccumulator({
    onDelta: (payload) => deltas.push(payload),
    onStable: (payload) => stables.push(payload)
  });

  accumulator.append({
    index: 0,
    id: 'call-1',
    function: {
      name: 'add',
      arguments: '{"a":1'
    }
  });
  accumulator.append({
    index: 0,
    function: {
      arguments: ',"b":2}'
    }
  });

  const finalized = accumulator.finalize();
  assert.equal(deltas.length, 2);
  assert.equal(stables.length, 1);
  assert.equal(stables[0].call_id, 'call-1');
  assert.equal(stables[0].name, 'add');
  assert.deepEqual(stables[0].args, { a: 1, b: 2 });
  assert.equal(finalized.parseErrors.length, 0);
  assert.equal(finalized.toolCalls.length, 1);
  assert.equal(finalized.toolCalls[0].call_id, 'call-1');
  assert.deepEqual(finalized.toolCalls[0].args, { a: 1, b: 2 });
});

test('ToolCallAccumulator suppresses duplicate stable emission with unchanged signature', () => {
  const stables = [];
  const accumulator = new ToolCallAccumulator({
    onStable: (payload) => stables.push(payload)
  });

  accumulator.append({
    index: 0,
    id: 'call-2',
    function: {
      name: 'echo',
      arguments: '{}'
    }
  });
  accumulator.append({
    index: 0
  });

  const finalized = accumulator.finalize();
  assert.equal(stables.length, 1);
  assert.equal(finalized.toolCalls.length, 1);
  assert.deepEqual(finalized.toolCalls[0].args, {});
});

test('ToolCallAccumulator reports parse error at finalize', () => {
  const parseErrors = [];
  const accumulator = new ToolCallAccumulator({
    onParseError: (payload) => parseErrors.push(payload)
  });

  accumulator.append({
    index: 0,
    id: 'call-3',
    function: {
      name: 'broken',
      arguments: '{"x":1'
    }
  });

  const finalized = accumulator.finalize();
  assert.equal(finalized.toolCalls.length, 0);
  assert.equal(finalized.parseErrors.length, 1);
  assert.equal(parseErrors.length, 1);
  assert.equal(parseErrors[0].call_id, 'call-3');
  assert.equal(typeof parseErrors[0].parse_reason, 'string');
  assert.ok(parseErrors[0].parse_reason.length > 0);
});
