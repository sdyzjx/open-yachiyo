const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTransferView, shouldFollowOutput } = require('../../apps/desktop-live2d/renderer/desktopChatState');

test('TC-DSK-013 transfer control explains offline and pending states', () => {
  assert.deepEqual(resolveTransferView({ phones: [], send: { canSend: false, reason: '没有在线的手机' } }), {
    phones: [], disabled: true, pending: false, label: '送到手机', reason: '没有在线的手机'
  });
  const pending = resolveTransferView({ busy: true, phones: [{ device_id: 'mi6', name: 'mi6' }], send: { canSend: false } });
  assert.equal(pending.disabled, true);
  assert.equal(pending.pending, true);
  assert.equal(pending.label, '送出中…');
});

test('TC-DSK-013 transfer control selects one of several online devices', () => {
  const shell = {
    phones: [{ device_id: 'a', name: 'A' }, { device_id: 'b', name: 'B' }],
    send: { canSend: true, reason: '' }
  };
  assert.equal(resolveTransferView(shell).disabled, true);
  assert.equal(resolveTransferView(shell, 'b').target, 'b');
  assert.equal(resolveTransferView(shell, 'b').label, '送到 B');
});

test('TC-DSK-015 output follows only while the reader remains near the bottom', () => {
  assert.equal(shouldFollowOutput({ scrollTop: 720, clientHeight: 240, scrollHeight: 1000 }), true);
  assert.equal(shouldFollowOutput({ scrollTop: 300, clientHeight: 240, scrollHeight: 1000 }), false);
});
