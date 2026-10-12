const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectHubState,
  computeShellState,
  buildMenuTemplate,
  resolveActivateAction
} = require('../../apps/desktop-live2d/main/shellModel');

const MI6 = { device_id: 'mi6', device_type: 'android', name: 'mi6', mode: 'normal' };
const PAD = { device_id: 'pad', device_type: 'android', name: '平板', mode: 'normal' };
const hub = (extra = {}) => ({ connected: true, host: 'desktop', pending_target: '', devices: [MI6], ...extra });
const shell = (hubExtra, extra) => computeShellState({ hub: hub(hubExtra), avatarVisible: true, chatOpen: false, ...extra });
const labels = (items) => items.filter((item) => item.type !== 'separator').map((item) => item.label);
const find = (items, prefix) => items.find((item) => String(item.label || '').startsWith(prefix));

test('TC-DSK-001 status line reflects gateway, desktop, phone and moving states', () => {
  assert.equal(shell({ connected: false }).statusLabel, '网关未连接');
  assert.equal(shell().statusLabel, '八千代在电脑上');
  assert.equal(shell({ host: 'mi6' }).statusLabel, '八千代在 mi6 上');
  assert.equal(shell({ host: 'ghost' }).statusLabel, '八千代在 ghost 上');
  assert.equal(shell({ host: '' }).statusLabel, '八千代位置同步中…');
  assert.equal(shell({ pending_target: 'mi6' }).statusLabel, '八千代正在移动…');
});

test('TC-DSK-001 tray menu on desktop: chat/hide/send enabled, no recall item', () => {
  const items = buildMenuTemplate(shell(), {}, 'tray');
  assert.deepEqual(labels(items), ['八千代在电脑上', '和八千代聊天', '隐藏八千代', '送到 mi6', '设置…', '退出 Yachiyo']);
  assert.equal(items[0].enabled, false);
  assert.equal(find(items, '和八千代聊天').enabled, true);
  assert.equal(find(items, '隐藏八千代').enabled, true);
  assert.equal(find(items, '送到 mi6').enabled, true);
  assert.equal(find(items, '设置…').enabled, true);
});

test('TC-DSK-001 tray menu with the avatar hidden offers show and refuses chat with a reason', () => {
  const items = buildMenuTemplate(shell({}, { avatarVisible: false }), {}, 'tray');
  const chat = find(items, '和八千代聊天');
  assert.equal(chat.enabled, false);
  assert.match(chat.label, /八千代已隐藏/);
  assert.equal(find(items, '显示八千代').enabled, true);
});

test('TC-DSK-001 tray menu with the avatar on the phone: recall shown, chat/hide/send disabled', () => {
  const items = buildMenuTemplate(shell({ host: 'mi6' }), {}, 'tray');
  assert.equal(find(items, '叫八千代回电脑').enabled, true);
  const chat = find(items, '和八千代聊天');
  assert.equal(chat.enabled, false);
  assert.match(chat.label, /不在电脑上/);
  assert.equal(find(items, '隐藏八千代').enabled, false);
  assert.equal(find(items, '送到 mi6').enabled, false);
});

test('TC-DSK-001 tray menu while disconnected leaves only settings and quit usable', () => {
  const items = buildMenuTemplate(shell({ connected: false, devices: [] }), {}, 'tray');
  assert.equal(find(items, '和八千代聊天').enabled, false);
  assert.match(find(items, '和八千代聊天').label, /网关未连接/);
  assert.equal(find(items, '叫八千代回电脑'), undefined);
  assert.equal(find(items, '送八千代到手机').enabled, false);
  assert.equal(find(items, '设置…').enabled, true);
  assert.equal(find(items, '退出 Yachiyo').enabled !== false, true);
});

test('TC-DSK-001 a transfer in flight disables everything that would race it', () => {
  const items = buildMenuTemplate(shell({ pending_target: 'mi6' }), {}, 'tray');
  for (const prefix of ['和八千代聊天', '隐藏八千代', '送到 mi6']) assert.equal(find(items, prefix).enabled, false, prefix);
  const back = buildMenuTemplate(shell({ host: 'mi6', pending_target: 'desktop' }), {}, 'tray');
  assert.equal(find(back, '叫八千代回电脑').enabled, false);
});

test('TC-DSK-001 send item: no phone is greyed, several phones become a submenu', () => {
  const none = find(buildMenuTemplate(shell({ devices: [] }), {}, 'tray'), '送八千代到手机');
  assert.equal(none.enabled, false);
  assert.match(none.label, /没有在线的手机/);

  const sent = [];
  const many = find(buildMenuTemplate(shell({ devices: [MI6, PAD, { device_id: 'pc2', device_type: 'desktop', name: 'x' }] }, {}), { sendToPhone: (id) => sent.push(id) }, 'tray'), '送八千代到手机');
  assert.equal(many.enabled, true);
  assert.deepEqual(many.submenu.map((item) => item.label), ['mi6', '平板']);
  many.submenu[1].click();
  assert.deepEqual(sent, ['pad']);
});

test('TC-DSK-001 menu items call the right actions', () => {
  const calls = [];
  const actions = Object.fromEntries(['openChat', 'closeChat', 'showAvatar', 'hideAvatar', 'recall', 'openSettings', 'quit'].map((name) => [name, () => calls.push(name)]));
  actions.sendToPhone = (id) => calls.push(`send:${id}`);
  const onDesktop = buildMenuTemplate(shell(), actions, 'tray');
  for (const prefix of ['和八千代聊天', '隐藏八千代', '送到 mi6', '设置…', '退出 Yachiyo']) find(onDesktop, prefix).click();
  const hidden = buildMenuTemplate(shell({}, { avatarVisible: false }), actions, 'tray');
  find(hidden, '显示八千代').click();
  find(buildMenuTemplate(shell({ host: 'mi6' }), actions, 'tray'), '叫八千代回电脑').click();
  assert.deepEqual(calls, ['openChat', 'hideAvatar', 'send:mi6', 'openSettings', 'quit', 'showAvatar', 'recall']);
});

test('TC-DSK-003 dock menu carries chat, recall, send and settings only', () => {
  assert.deepEqual(labels(buildMenuTemplate(shell(), {}, 'dock')), ['和八千代聊天', '送到 mi6', '设置…']);
  assert.deepEqual(labels(buildMenuTemplate(shell({ host: 'mi6' }), {}, 'dock')), [
    '和八千代聊天（八千代不在电脑上）', '叫八千代回电脑', '送到 mi6（八千代不在电脑上）', '设置…'
  ]);
});

test('TC-DSK-003 dock click opens chat when the avatar is available, otherwise settings', () => {
  assert.equal(resolveActivateAction(shell()), 'openChat');
  assert.equal(resolveActivateAction(shell({}, { avatarVisible: false })), 'openSettings');
  assert.equal(resolveActivateAction(shell({ host: 'mi6' })), 'openSettings');
  assert.equal(resolveActivateAction(shell({ connected: false })), 'openSettings');
  assert.equal(resolveActivateAction(shell({ pending_target: 'mi6' })), 'openSettings');
});

test('TC-DSK-004 avatar context menu toggles chat, hides, sends and opens settings', () => {
  const closed = buildMenuTemplate(shell(), {}, 'avatar');
  assert.deepEqual(labels(closed), ['打开聊天', '隐藏八千代', '送到 mi6', '设置…']);
  const open = buildMenuTemplate(shell({}, { chatOpen: true }), {}, 'avatar');
  assert.deepEqual(labels(open), ['关闭聊天', '隐藏八千代', '送到 mi6', '设置…']);
  assert.equal(find(open, '关闭聊天').enabled, true);
});

test('projectHubState normalises the host, trims device fields and ignores junk', () => {
  const state = projectHubState({
    connected: true, host: 'desktop-me', deviceId: 'desktop-me', transferTarget: 'mi6',
    devices: [{ device_id: 'mi6', device_type: 'android', name: 'x'.repeat(200), token: 'secret' }, null, { nope: 1 }]
  });
  assert.equal(state.host, 'desktop');
  assert.equal(state.pending_target, 'mi6');
  assert.equal(state.devices.length, 1);
  assert.equal(state.devices[0].name.length, 80);
  assert.equal('token' in state.devices[0], false);
  assert.deepEqual(projectHubState(null), { connected: false, host: '', pending_target: '', devices: [] });
});
