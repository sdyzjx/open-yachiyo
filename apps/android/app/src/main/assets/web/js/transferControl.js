(function expose(root) {
  'use strict';

  function normalizeDevices(devices) {
    return Array.isArray(devices) ? devices.filter((device) => device && typeof device.device_id === 'string') : [];
  }

  function resolveAndroidTransferControl({ hub = {}, deviceId = '', pending = false } = {}) {
    const state = String(hub.state || 'disconnected');
    const host = String(hub.avatar_host || '');
    const desktopOnline = normalizeDevices(hub.devices).some((device) => device.device_type === 'desktop');
    const desktopState = desktopOnline ? '电脑在线' : '电脑离线';
    if (state !== 'connected') {
      return {
        disabled: true,
        label: state === 'connecting' ? '正在连接…' : '设备未连接',
        reason: state === 'unauthorized' ? '配对信息无效' : '连接后可迁移角色',
        owner: host,
        desktopOnline
      };
    }
    if (pending) return { disabled: true, label: '迁移中…', reason: `${host === deviceId ? '当前在手机' : '正在接送八千代'} · ${desktopState}`, owner: host, desktopOnline };
    if (!host) return { disabled: true, label: '同步中…', reason: '等待当前角色位置', owner: '', desktopOnline };
    if (host !== deviceId) {
      return {
        disabled: false,
        label: '让她过来',
        reason: `${host === 'desktop' ? '当前在电脑' : '当前在其他设备'} · ${desktopState}`,
        target: deviceId,
        owner: host,
        desktopOnline
      };
    }
    return {
      disabled: !desktopOnline,
      label: '叫回电脑',
      reason: `当前在手机 · ${desktopState}`,
      ...(desktopOnline ? { target: 'desktop' } : {}),
      owner: host,
      desktopOnline
    };
  }

  function createAndroidTransferController({ getSnapshot, request, onView = () => {}, setPending = () => {} } = {}) {
    if (typeof getSnapshot !== 'function' || typeof request !== 'function') throw new Error('transfer controller requires getSnapshot and request');
    function refresh() {
      const view = resolveAndroidTransferControl(getSnapshot());
      onView(view);
      return view;
    }
    async function activate(target) {
      const view = refresh();
      if (view.disabled || !view.target || view.target !== target) return { ok: false, reason: view.reason || '角色当前无法迁移' };
      setPending(true);
      refresh();
      try {
        await request(view.target);
        return { ok: true, target: view.target };
      } catch (error) {
        return { ok: false, reason: error && error.message ? error.message : String(error) };
      } finally {
        setPending(false);
        refresh();
      }
    }
    return { refresh, activate };
  }

  // Invalidates asynchronous prepare/exit/enter continuations when a transfer is cancelled,
  // superseded, or completed. This prevents a stale enter handler from acknowledging after cancel.
  function createTransferEventGuard() {
    let generation = 0;
    let activeId = '';
    function begin(transferId) {
      generation += 1;
      activeId = String(transferId || '');
      return { generation, transferId: activeId };
    }
    function isCurrent(ticket) {
      return !!ticket && ticket.generation === generation && ticket.transferId === activeId;
    }
    function clear(transferId) {
      const id = String(transferId || '');
      if (id && id !== activeId) return false;
      generation += 1;
      activeId = '';
      return true;
    }
    return { begin, isCurrent, clear, get activeId() { return activeId; } };
  }

  const api = { createAndroidTransferController, createTransferEventGuard, resolveAndroidTransferControl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YachiyoTransferControl = api;
})(typeof window === 'undefined' ? globalThis : window);
