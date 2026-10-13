const { fault } = require('./hub');
const { isSessionApprovalMode } = require('../../runtime/session/sessionPermissions');

const METHOD_NAMES = Object.freeze([
  'session.settings.get',
  'session.settings.update',
  'approval.pending.list',
  'approval.decision'
]);

function deviceSessionId(device) {
  return `device-${device.device_id}`;
}

function attachSessionControl({ hub, sessionStore, approvalCoordinator }) {
  if (!sessionStore || !approvalCoordinator) return null;

  const methods = {
    async 'session.settings.get'(_params, device) {
      const sessionId = deviceSessionId(device);
      return await sessionStore.getSessionSettings(sessionId)
        || sessionStore.updateSessionSettings(sessionId, {});
    },

    async 'session.settings.update'(params, device) {
      const approvalMode = typeof params?.approval_mode === 'string'
        ? params.approval_mode.trim().toLowerCase()
        : '';
      if (!isSessionApprovalMode(approvalMode)) {
        throw fault(-32602, 'approval_mode must be manual|auto_approve|full_access');
      }
      return sessionStore.updateSessionSettings(deviceSessionId(device), {
        approval_mode: approvalMode
      });
    },

    'approval.pending.list'(_params, device) {
      return approvalCoordinator.list({ sessionId: deviceSessionId(device) });
    },

    'approval.decision'(params, device) {
      if (typeof params?.approval_id !== 'string' || !params.approval_id.trim()
        || typeof params?.approved !== 'boolean') {
        throw fault(-32602, 'approval_id and boolean approved are required');
      }
      const decided = approvalCoordinator.decide({
        approvalId: params.approval_id.trim(),
        sessionId: deviceSessionId(device),
        approved: params.approved,
        scope: params.scope
      });
      if (!decided) throw fault(-32602, 'approval not found for this device session');
      return {
        approval_id: params.approval_id.trim(),
        approved: params.approved,
        scope: params.scope === 'always' ? 'always' : 'once'
      };
    }
  };

  for (const [name, handler] of Object.entries(methods)) hub.methods.set(name, handler);
  hub.once('shutdown', () => {
    for (const [name, handler] of Object.entries(methods)) {
      if (hub.methods.get(name) === handler) hub.methods.delete(name);
    }
  });
  return methods;
}

module.exports = { METHOD_NAMES, attachSessionControl, deviceSessionId };
