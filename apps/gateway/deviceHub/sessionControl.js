const { fault } = require('./hub');
const { randomUUID } = require('node:crypto');
const { isSessionApprovalMode } = require('../../runtime/session/sessionPermissions');

const METHOD_NAMES = Object.freeze([
  'session.settings.get',
  'session.settings.update',
  'session.list',
  'session.history',
  'session.create',
  'session.select',
  'approval.pending.list',
  'approval.decision'
]);

function deviceSessionId(device) {
  return device.session_id || `device-${device.device_id}`;
}

function ownsDeviceSession(device, sessionId) {
  const value = String(sessionId || '');
  const root = `device-${device.device_id}`;
  return value === root || value.startsWith(`${root}--`);
}

function publicMessages(session) {
  return (Array.isArray(session?.messages) ? session.messages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .slice(-200)
    .map((message) => ({
      id: String(message.id || ''),
      role: message.role,
      content: String(message.content || ''),
      created_at: message.created_at || null
    }));
}

function publicHistory(session) {
  return {
    session_id: session.session_id,
    title: session.title || 'New chat',
    updated_at: session.updated_at || null,
    messages: publicMessages(session)
  };
}

function attachSessionControl({ hub, sessionStore, approvalCoordinator }) {
  if (!sessionStore || !approvalCoordinator) return null;

  const methods = {
    async 'session.list'(params, device) {
      const limit = Math.max(1, Math.min(Number(params?.limit) || 40, 80));
      const offset = Math.max(0, Number(params?.offset) || 0);
      const root = `device-${device.device_id}`;
      const all = await sessionStore.listSessions({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
      const owned = all.items.filter((item) => item.session_id === root || item.session_id.startsWith(`${root}--`));
      return {
        current_session_id: deviceSessionId(device),
        total: owned.length,
        items: owned.slice(offset, offset + limit)
      };
    },

    async 'session.history'(params, device) {
      const sessionId = String(params?.session_id || deviceSessionId(device)).trim();
      if (!ownsDeviceSession(device, sessionId)) throw fault(-32006, 'session is not owned by this device');
      const session = await sessionStore.getSession(sessionId);
      if (!session) throw fault(-32602, 'session not found');
      return publicHistory(session);
    },

    async 'session.create'(params, device) {
      const sessionId = `device-${device.device_id}--${randomUUID()}`;
      const title = String(params?.title || 'New chat').trim().slice(0, 80) || 'New chat';
      const session = await sessionStore.createSessionIfNotExists({ sessionId, title });
      device.session_id = sessionId;
      return publicHistory(session);
    },

    async 'session.select'(params, device) {
      const sessionId = String(params?.session_id || '').trim();
      if (!ownsDeviceSession(device, sessionId)) throw fault(-32006, 'session is not owned by this device');
      const session = await sessionStore.getSession(sessionId);
      if (!session) throw fault(-32602, 'session not found');
      device.session_id = sessionId;
      return publicHistory(session);
    },

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

module.exports = { METHOD_NAMES, attachSessionControl, deviceSessionId, ownsDeviceSession, publicHistory };
