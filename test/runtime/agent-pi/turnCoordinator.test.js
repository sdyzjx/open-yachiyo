const test = require('node:test');
const assert = require('node:assert/strict');
const { TurnCoordinator } = require('../../../apps/runtime/agent-pi/turnCoordinator');

function events() {
  return { accepted: [], accept(event) { this.accepted.push(event.type); } };
}

test('TC-PI-034 coordinator resolves the active turn and activates queued input at the next boundary', async () => {
  const activated = [];
  const coordinator = new TurnCoordinator({ onActivate: (tracker) => activated.push(tracker.input) });
  const first = coordinator.register({ input: 'first', events: events(), startsImmediately: true });
  const second = coordinator.register({ input: 'second', events: events(), startsImmediately: false });
  coordinator.accept({ type: 'turn_start' });
  coordinator.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'one' }] } });
  assert.deepEqual(await first.promise, { output: 'one', state: 'DONE', error: null });
  assert.equal(coordinator.current(), null);
  coordinator.accept({ type: 'turn_start' });
  assert.equal(coordinator.current(), second);
  coordinator.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'two' }] } });
  assert.deepEqual(await second.promise, { output: 'two', state: 'DONE', error: null });
  assert.deepEqual(activated, ['first', 'second']);
});

test('TC-PI-034 coordinator keeps a tool turn active until its final assistant message', async () => {
  const coordinator = new TurnCoordinator();
  const tracker = coordinator.register({ events: events(), startsImmediately: true });
  coordinator.accept({ type: 'message_end', message: {
    role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c', name: 'read', arguments: {} }]
  } });
  assert.equal(tracker.settled, false);
  coordinator.accept({ type: 'message_end', message: {
    role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'finished' }]
  } });
  assert.equal((await tracker.promise).output, 'finished');
});

test('TC-PI-034 a delivered steering user message supersedes the unfinished tool turn', async () => {
  const coordinator = new TurnCoordinator();
  const first = coordinator.register({ input: 'first', events: events(), startsImmediately: true });
  const second = coordinator.register({ input: 'second', events: events(), startsImmediately: false });
  coordinator.accept({ type: 'message_start', message: {
    role: 'user', content: [{ type: 'text', text: 'second' }]
  } });
  assert.equal((await first.promise).state, 'SUPERSEDED');
  assert.equal(coordinator.current(), second);
});
