/* Pure state helpers for the session approval UI. */
(function (global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.YachiyoSessionApproval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODES = Object.freeze({
    manual: Object.freeze({ label: '每次询问', shortLabel: '询问', description: '执行高风险命令前，由你逐次允许或拒绝。' }),
    auto_approve: Object.freeze({ label: '自动批准', shortLabel: '自动', description: '自动批准需要确认的命令，同时保留工具安全边界。' }),
    full_access: Object.freeze({ label: '完全访问', shortLabel: '完全', description: '允许 Agent 在当前会话中使用完整设备能力。' })
  });

  function normalizeMode(value) {
    const key = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MODES, key) ? key : 'manual';
  }

  function normalizeRequest(value) {
    if (!value || typeof value !== 'object') return null;
    const approvalId = String(value.approval_id || '').trim();
    if (!approvalId) return null;
    return {
      approval_id: approvalId,
      session_id: String(value.session_id || ''),
      tool_name: String(value.tool_name || 'shell.exec'),
      command: String(value.command || ''),
      reason: String(value.reason || ''),
      created_at_ms: Number(value.created_at_ms) || 0,
      expires_at_ms: Number(value.expires_at_ms) || 0
    };
  }

  function upsertPending(items, value) {
    const request = normalizeRequest(value);
    if (!request) return Array.isArray(items) ? items.slice() : [];
    const next = (Array.isArray(items) ? items : [])
      .map(normalizeRequest)
      .filter(Boolean)
      .filter((item) => item.approval_id !== request.approval_id);
    next.push(request);
    return next.sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  function removePending(items, approvalId) {
    const id = String(approvalId || '').trim();
    return (Array.isArray(items) ? items : []).filter((item) => item && item.approval_id !== id);
  }

  function isExpired(request, now = Date.now()) {
    return Number(request?.expires_at_ms) > 0 && Number(request.expires_at_ms) <= Number(now);
  }

  return { MODES, normalizeMode, normalizeRequest, upsertPending, removePending, isExpired };
});
