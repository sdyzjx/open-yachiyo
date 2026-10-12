'use strict';

/*
 * Pure model for the desktop shell (menu bar, Dock, avatar context menu, chat gating).
 * Everything here is derived from two inputs: the Device Hub snapshot and the avatar window
 * visibility, so every surface shows the same truth. No Electron imports: fully unit-testable.
 */

const REASONS = Object.freeze({
  disconnected: '网关未连接',
  notOnDesktop: '八千代不在电脑上',
  busy: '八千代正在移动',
  hidden: '八千代已隐藏'
});

function projectHubState(client) {
  const devices = Array.isArray(client?.devices) ? client.devices : [];
  const rawHost = typeof client?.host === 'string' ? client.host : '';
  return {
    connected: client?.connected === true,
    host: rawHost && rawHost === client?.deviceId ? 'desktop' : rawHost,
    pending_target: typeof client?.transferTarget === 'string' ? client.transferTarget : '',
    devices: devices
      .filter((device) => device && typeof device.device_id === 'string')
      .map((device) => ({
        device_id: device.device_id,
        device_type: String(device.device_type || ''),
        name: String(device.name || device.device_id).slice(0, 80),
        mode: String(device.mode || '').slice(0, 24)
      }))
  };
}

function phonesOf(hub) {
  return (Array.isArray(hub?.devices) ? hub.devices : [])
    .filter((device) => device && device.device_type === 'android' && device.device_id)
    .map((device) => ({ device_id: device.device_id, name: String(device.name || device.device_id) }));
}

function computeShellState({ hub = {}, avatarVisible = false, chatOpen = false } = {}) {
  const connected = hub.connected === true;
  const host = String(hub.host || '');
  const busy = Boolean(hub.pending_target);
  const phones = phonesOf(hub);
  const onDesktop = connected && host === 'desktop';
  const hostDevice = (Array.isArray(hub.devices) ? hub.devices : []).find((device) => device.device_id === host);

  let location = 'syncing';
  let statusLabel = '八千代位置同步中…';
  if (!connected) {
    location = 'offline';
    statusLabel = REASONS.disconnected;
  } else if (busy) {
    location = host === 'desktop' ? 'desktop' : (host ? 'phone' : 'syncing');
    statusLabel = '八千代正在移动…';
  } else if (host === 'desktop') {
    location = 'desktop';
    statusLabel = '八千代在电脑上';
  } else if (host) {
    location = 'phone';
    statusLabel = `八千代在 ${hostDevice?.name || host} 上`;
  }

  let chatReason = '';
  if (!connected) chatReason = REASONS.disconnected;
  else if (host !== 'desktop') chatReason = REASONS.notOnDesktop;
  else if (busy) chatReason = REASONS.busy;
  else if (!avatarVisible) chatReason = REASONS.hidden;

  let toggleReason = '';
  if (!connected) toggleReason = REASONS.disconnected;
  else if (host !== 'desktop') toggleReason = REASONS.notOnDesktop;
  else if (busy) toggleReason = REASONS.busy;

  let sendReason = '';
  if (!connected) sendReason = REASONS.disconnected;
  else if (host !== 'desktop') sendReason = REASONS.notOnDesktop;
  else if (busy) sendReason = REASONS.busy;
  else if (phones.length === 0) sendReason = '没有在线的手机';

  return {
    connected,
    host,
    location,
    busy,
    statusLabel,
    avatarOnDesktop: onDesktop && !busy,
    avatarVisible: Boolean(avatarVisible),
    chat: {
      open: Boolean(chatOpen),
      canOpen: chatReason === '',
      reason: chatReason
    },
    visibility: {
      visible: Boolean(avatarVisible),
      canToggle: toggleReason === '',
      reason: toggleReason
    },
    recall: {
      show: connected && Boolean(host) && host !== 'desktop',
      enabled: connected && Boolean(host) && host !== 'desktop' && !busy
    },
    phones,
    send: {
      canSend: sendReason === '',
      reason: sendReason
    }
  };
}

function withReason(label, reason) {
  return reason ? `${label}（${reason}）` : label;
}

function sendItem(shell, actions) {
  const { phones, send } = shell;
  if (phones.length > 1) {
    return {
      label: withReason('送八千代到手机', send.reason),
      enabled: send.canSend,
      submenu: phones.map((phone) => ({
        label: phone.name,
        enabled: send.canSend,
        click: () => actions.sendToPhone?.(phone.device_id)
      }))
    };
  }
  if (phones.length === 1) {
    return {
      label: withReason(`送到 ${phones[0].name}`, send.reason),
      enabled: send.canSend,
      click: () => actions.sendToPhone?.(phones[0].device_id)
    };
  }
  return { label: withReason('送八千代到手机', send.reason), enabled: false };
}

/**
 * Electron menu template for one surface.
 * variant: 'tray' (menu bar, full), 'dock' (chat/recall/send/settings), 'avatar' (right click on the character).
 */
function buildMenuTemplate(shell, actions = {}, variant = 'tray') {
  const chatItem = {
    label: withReason('和八千代聊天', shell.chat.canOpen ? '' : shell.chat.reason),
    enabled: shell.chat.canOpen,
    click: () => actions.openChat?.()
  };
  const toggleChatItem = shell.chat.open
    ? { label: '关闭聊天', enabled: true, click: () => actions.closeChat?.() }
    : { label: withReason('打开聊天', shell.chat.canOpen ? '' : shell.chat.reason), enabled: shell.chat.canOpen, click: () => actions.openChat?.() };
  const visibilityItem = {
    label: withReason(shell.visibility.visible ? '隐藏八千代' : '显示八千代', shell.visibility.canToggle ? '' : shell.visibility.reason),
    enabled: shell.visibility.canToggle,
    click: () => (shell.visibility.visible ? actions.hideAvatar?.() : actions.showAvatar?.())
  };
  const recallItem = {
    label: '叫八千代回电脑',
    enabled: shell.recall.enabled,
    click: () => actions.recall?.()
  };
  const settingsItem = { label: '设置…', enabled: true, click: () => actions.openSettings?.() };

  if (variant === 'avatar') {
    return [
      toggleChatItem,
      { label: '隐藏八千代', enabled: shell.visibility.canToggle, click: () => actions.hideAvatar?.() },
      sendItem(shell, actions),
      { type: 'separator' },
      settingsItem
    ];
  }
  if (variant === 'dock') {
    return [
      chatItem,
      ...(shell.recall.show ? [recallItem] : []),
      sendItem(shell, actions),
      { type: 'separator' },
      settingsItem
    ];
  }
  return [
    { label: shell.statusLabel, enabled: false },
    { type: 'separator' },
    chatItem,
    visibilityItem,
    ...(shell.recall.show ? [recallItem] : []),
    sendItem(shell, actions),
    { type: 'separator' },
    settingsItem,
    { type: 'separator' },
    { label: '退出 Yachiyo', click: () => actions.quit?.() }
  ];
}

/** What a Dock click should do: chat when the avatar is available on the desktop, otherwise settings. */
function resolveActivateAction(shell) {
  return shell.chat.canOpen ? 'openChat' : 'openSettings';
}

module.exports = {
  REASONS,
  projectHubState,
  computeShellState,
  buildMenuTemplate,
  resolveActivateAction
};
