(function exposeDesktopChatState(root) {
  'use strict';

  function phonesFrom(shell = {}) {
    return (Array.isArray(shell.phones) ? shell.phones : [])
      .filter((phone) => phone && typeof phone.device_id === 'string')
      .map((phone) => ({ device_id: phone.device_id, name: String(phone.name || phone.device_id) }));
  }

  function resolveTransferView(shell = {}, selectedTarget = '') {
    const phones = phonesFrom(shell);
    const pending = Boolean(shell.busy);
    const reason = String(shell?.send?.reason || '');
    if (pending) return { phones, disabled: true, pending: true, label: '送出中…', reason: '角色正在迁移，请稍候' };
    if (phones.length === 0) return { phones, disabled: true, pending: false, label: '送到手机', reason: reason || '没有在线的手机' };
    if (!shell?.send?.canSend) return { phones, disabled: true, pending: false, label: '送到手机', reason: reason || '当前不可迁移' };
    if (phones.length === 1) return {
      phones, disabled: false, pending: false, label: `送到 ${phones[0].name}`, reason: '', target: phones[0].device_id
    };
    const selected = phones.find((phone) => phone.device_id === selectedTarget);
    return {
      phones,
      disabled: !selected,
      pending: false,
      label: selected ? `送到 ${selected.name}` : '送到手机',
      reason: selected ? '' : '请先选择一台在线手机',
      target: selected?.device_id || '',
      requiresSelection: true
    };
  }

  function shouldFollowOutput({ scrollTop = 0, scrollHeight = 0, clientHeight = 0, threshold = 72 } = {}) {
    return Number(scrollHeight) - Number(clientHeight) - Number(scrollTop) <= Number(threshold);
  }

  const api = { phonesFrom, resolveTransferView, shouldFollowOutput };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopChatState = api;
})(typeof window === 'undefined' ? globalThis : window);
