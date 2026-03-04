const crypto = require('crypto');

const PENDING_APPROVAL_TTL_MS = 10 * 60 * 1000;
const stateBySession = new Map();

function normalizeSessionKey(sessionId) {
  const raw = String(sessionId || '').trim();
  return raw || '__global__';
}

function nowMs() {
  return Date.now();
}

function commandFingerprint(command) {
  return crypto.createHash('sha256').update(String(command || '').trim()).digest('hex');
}

function ensureState(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  if (!stateBySession.has(key)) {
    stateBySession.set(key, {
      always: new Set(),
      once: new Map(),
      pendingById: new Map(),
      pendingByFingerprint: new Map()
    });
  }
  return stateBySession.get(key);
}

function prunePending(state, now = nowMs()) {
  if (!state) return;
  for (const [approvalId, request] of state.pendingById.entries()) {
    const expiresAt = Number(request?.expires_at_ms);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      state.pendingById.delete(approvalId);
      if (request?.fingerprint) {
        state.pendingByFingerprint.delete(request.fingerprint);
      }
    }
  }
}

function createShellApprovalRequest({ sessionId, command, reason = 'manual_approval_required' }) {
  const sessionKey = normalizeSessionKey(sessionId);
  const state = ensureState(sessionKey);
  prunePending(state);
  const normalizedCommand = String(command || '').trim();
  const fingerprint = commandFingerprint(normalizedCommand);

  const existingId = state.pendingByFingerprint.get(fingerprint);
  if (existingId && state.pendingById.has(existingId)) {
    return state.pendingById.get(existingId);
  }

  const approvalId = `apr_${crypto.randomBytes(9).toString('hex')}`;
  const createdAt = nowMs();
  const request = {
    approval_id: approvalId,
    session_id: sessionKey,
    command: normalizedCommand,
    fingerprint,
    reason,
    created_at_ms: createdAt,
    expires_at_ms: createdAt + PENDING_APPROVAL_TTL_MS
  };

  state.pendingById.set(approvalId, request);
  state.pendingByFingerprint.set(fingerprint, approvalId);
  return request;
}

function grantShellApproval({ sessionId, approvalId, scope = 'once' }) {
  const sessionKey = normalizeSessionKey(sessionId);
  const state = ensureState(sessionKey);
  prunePending(state);
  const normalizedId = String(approvalId || '').trim();
  if (!normalizedId) return null;

  const request = state.pendingById.get(normalizedId);
  if (!request) return null;

  state.pendingById.delete(normalizedId);
  state.pendingByFingerprint.delete(request.fingerprint);

  const normalizedScope = String(scope || 'once').toLowerCase() === 'always' ? 'always' : 'once';
  if (normalizedScope === 'always') {
    state.always.add(request.fingerprint);
  } else {
    const current = Number(state.once.get(request.fingerprint) || 0);
    state.once.set(request.fingerprint, current + 1);
  }

  return {
    approval_id: request.approval_id,
    command: request.command,
    session_id: sessionKey,
    scope: normalizedScope
  };
}

function consumeShellApproval({ sessionId, command }) {
  const sessionKey = normalizeSessionKey(sessionId);
  const state = ensureState(sessionKey);
  prunePending(state);
  const fingerprint = commandFingerprint(command);

  if (state.always.has(fingerprint)) {
    return { approved: true, scope: 'always' };
  }

  const onceCount = Number(state.once.get(fingerprint) || 0);
  if (onceCount > 0) {
    if (onceCount <= 1) {
      state.once.delete(fingerprint);
    } else {
      state.once.set(fingerprint, onceCount - 1);
    }
    return { approved: true, scope: 'once' };
  }

  return { approved: false, scope: null };
}

function __resetShellApprovalStoreForTests() {
  stateBySession.clear();
}

module.exports = {
  createShellApprovalRequest,
  grantShellApproval,
  consumeShellApproval,
  __resetShellApprovalStoreForTests
};
