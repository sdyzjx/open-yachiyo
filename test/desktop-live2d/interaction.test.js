const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCooldownGate,
  nearlyEqual,
  shouldUpdate2D,
  isImeComposingEvent,
  isDragDisplacement
} = require('../../apps/desktop-live2d/renderer/interaction');

test('createCooldownGate blocks repeated toggles until cooldown expires', () => {
  let now = 1000;
  const gate = createCooldownGate({
    cooldownMs: 200,
    now: () => now
  });

  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), false);

  now = 1199;
  assert.equal(gate.tryEnter(), false);

  now = 1200;
  assert.equal(gate.tryEnter(), true);
});

test('createCooldownGate reset clears blocked state', () => {
  const gate = createCooldownGate({
    cooldownMs: 200,
    now: () => 1000
  });

  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), false);
  gate.reset();
  assert.equal(gate.tryEnter(), true);
});

test('nearlyEqual and shouldUpdate2D compare transform deltas with epsilon', () => {
  assert.equal(nearlyEqual(1, 1.00004, 1e-3), true);
  assert.equal(nearlyEqual(1, 1.01, 1e-3), false);
  assert.equal(nearlyEqual('x', 1), false);

  assert.equal(shouldUpdate2D(10, 20, 10.00001, 20.00001, 1e-3), false);
  assert.equal(shouldUpdate2D(10, 20, 10.1, 20, 1e-3), true);
});

test('isImeComposingEvent detects composition states from event and fallback', () => {
  assert.equal(isImeComposingEvent({ isComposing: true }, false), true);
  assert.equal(isImeComposingEvent({ keyCode: 229 }, false), true);
  assert.equal(isImeComposingEvent({ isComposing: false, keyCode: 13 }, true), true);
  assert.equal(isImeComposingEvent({ isComposing: false, keyCode: 13 }, false), false);
});

test('TC-DSK-006 avatar movement over 4 px is a drag rather than a click', () => {
  assert.equal(isDragDisplacement(4, 0), false);
  assert.equal(isDragDisplacement(4.01, 0), true);
  assert.equal(isDragDisplacement(3, 3), true);
});
