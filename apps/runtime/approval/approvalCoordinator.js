const { ErrorCode } = require('../tooling/errors');
const { grantShellApproval } = require('../tooling/shellApprovalStore');
const { normalizeSessionApprovalMode } = require('../session/sessionPermissions');

class ApprovalCoordinator {
  constructor({ bus, timeoutMs = 120000 } = {}) {
    this.bus = bus;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  list({ sessionId } = {}) {
    return [...this.pending.values()]
      .filter((entry) => !sessionId || entry.session_id === sessionId)
      .map(({ resolve, timer, promise, ...entry }) => ({ ...entry }));
  }

  decide({ approvalId, sessionId, approved, scope = 'once' }) {
    const entry = this.pending.get(String(approvalId || ''));
    if (!entry || (sessionId && entry.session_id !== sessionId)) return false;
    clearTimeout(entry.timer);
    this.pending.delete(entry.approval_id);
    entry.resolve({ approved: approved === true, scope: scope === 'always' ? 'always' : 'once' });
    return true;
  }

  async coordinate({ result, execute, context = {}, signal, toolName }) {
    if (result?.code !== ErrorCode.APPROVAL_REQUIRED) return result;
    const details = result.details || {};
    const approvalId = String(details.approval_id || '');
    const sessionId = String(context.session_id || '__global__');
    if (!approvalId || toolName !== 'shell.exec') return result;
    const mode = normalizeSessionApprovalMode(context.approval_mode);
    let decision;
    if (mode === 'auto_approve' || mode === 'full_access') {
      decision = { approved: true, scope: 'once', automatic: true };
    } else {
      decision = await this.waitForDecision({
        approval_id: approvalId,
        session_id: sessionId,
        tool_name: toolName,
        command: String(details.command || ''),
        reason: String(details.reason || 'manual_approval_required'),
        created_at_ms: Date.now(),
        expires_at_ms: Date.now() + this.timeoutMs
      }, signal);
    }
    if (!decision.approved) {
      const reason = decision.timeout ? 'timeout' : decision.aborted ? 'aborted' : 'denied';
      const denied = {
        ok: false,
        code: ErrorCode.PERMISSION_DENIED,
        error: decision.timeout ? 'Tool approval timed out' : decision.aborted ? 'Tool approval cancelled' : 'Tool approval denied',
        details: { approval_id: approvalId, reason }
      };
      this.bus?.publish('approval.resolved', { session_id: sessionId, approval_id: approvalId, approved: false,
        reason: denied.details.reason });
      return denied;
    }
    const granted = grantShellApproval({ sessionId, approvalId, scope: decision.scope });
    if (!granted) {
      return { ok: false, code: ErrorCode.VALIDATION_ERROR, error: 'Approval request expired before execution',
        details: { approval_id: approvalId } };
    }
    this.bus?.publish('approval.resolved', { session_id: sessionId, approval_id: approvalId, approved: true,
      automatic: Boolean(decision.automatic), scope: granted.scope });
    return execute();
  }

  waitForDecision(request, signal) {
    if (signal?.aborted) return Promise.resolve({ approved: false, aborted: true });
    if (this.pending.has(request.approval_id)) return this.pending.get(request.approval_id).promise;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const finish = (decision) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(decision);
    };
    const timer = setTimeout(() => {
      this.pending.delete(request.approval_id);
      finish({ approved: false, timeout: true });
    }, this.timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      this.pending.delete(request.approval_id);
      finish({ approved: false, aborted: true });
    };
    const entry = { ...request, promise, resolve: finish, timer };
    this.pending.set(request.approval_id, entry);
    signal?.addEventListener('abort', onAbort, { once: true });
    this.bus?.publish('approval.requested', { ...request, approval_mode: 'manual' });
    return promise;
  }

  dispose() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, aborted: true });
    }
    this.pending.clear();
  }
}

module.exports = { ApprovalCoordinator };
