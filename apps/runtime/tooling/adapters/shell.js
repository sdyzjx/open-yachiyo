const { spawn } = require('child_process');
const path = require('path');
const { ToolingError, ErrorCode } = require('../errors');
const { getShellPermissionProfile } = require('../../security/sessionPermissionPolicy');
const {
  createShellApprovalRequest,
  grantShellApproval,
  consumeShellApproval
} = require('../shellApprovalStore');

function splitCommand(command) {
  const parts = command.match(/(?:"[^"]*"|'[^']*'|\S)+/g) || [];
  return parts.map((p) => p.replace(/^['"]|['"]$/g, ''));
}

function hasShellOperators(command) {
  return /(?:\|\||&&|[;&|><`$()])/.test(String(command || ''));
}

function getSessionIdFromContext(context = {}) {
  return String(context.session_id || context.sessionId || '').trim() || '__global__';
}

function isInsideWorkspace(workspaceRoot, absolutePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolvePathToken(cwd, token) {
  if (!token || token === '-') return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return null;
  const raw = String(token);
  const homeDir = os.homedir();
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/')) return path.join(homeDir, raw.slice(2));
  return path.resolve(cwd, raw);
}

function nonOptionArgs(argv) {
  return argv.filter((item) => item && !item.startsWith('-'));
}

function collectPathIntent(bin, argv, cwd) {
  const readPaths = [];
  const writePaths = [];

  if (['ls', 'cat', 'head', 'tail', 'wc', 'stat'].includes(bin)) {
    for (const arg of nonOptionArgs(argv)) {
      const resolved = resolvePathToken(cwd, arg);
      if (resolved) readPaths.push(resolved);
    }
    return { readPaths, writePaths };
  }

  if (bin === 'grep') {
    const args = nonOptionArgs(argv);
    for (const arg of args.slice(1)) {
      const resolved = resolvePathToken(cwd, arg);
      if (resolved) readPaths.push(resolved);
    }
    return { readPaths, writePaths };
  }

  if (bin === 'find') {
    const args = nonOptionArgs(argv);
    const scanPaths = args.length > 0 ? [args[0]] : [];
    for (const p of scanPaths) {
      const resolved = resolvePathToken(cwd, p);
      if (resolved) readPaths.push(resolved);
    }
    return { readPaths, writePaths };
  }

  if (['mkdir', 'touch', 'rm'].includes(bin)) {
    for (const arg of nonOptionArgs(argv)) {
      const resolved = resolvePathToken(cwd, arg);
      if (resolved) writePaths.push(resolved);
    }
    return { readPaths, writePaths };
  }

  if (bin === 'cp') {
    const args = nonOptionArgs(argv);
    if (args.length < 2) {
      throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'cp requires source and destination');
    }
    const sources = args.slice(0, -1);
    const destination = args[args.length - 1];
    for (const source of sources) {
      const resolved = resolvePathToken(cwd, source);
      if (resolved) readPaths.push(resolved);
    }
    const resolvedDest = resolvePathToken(cwd, destination);
    if (resolvedDest) writePaths.push(resolvedDest);
    return { readPaths, writePaths };
  }

  if (bin === 'mv') {
    const args = nonOptionArgs(argv);
    if (args.length < 2) {
      throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'mv requires source and destination');
    }
    for (const arg of args) {
      const resolved = resolvePathToken(cwd, arg);
      if (resolved) writePaths.push(resolved);
    }
    return { readPaths, writePaths };
  }

  if (bin === 'curl') {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      const next = argv[i + 1];
      if ((arg === '-o' || arg === '--output') && next) {
        const resolved = resolvePathToken(cwd, next);
        if (resolved) writePaths.push(resolved);
      }
      if ((arg === '-K' || arg === '--config') && next) {
        const resolved = resolvePathToken(cwd, next);
        if (resolved) readPaths.push(resolved);
      }
    }
    return { readPaths, writePaths };
  }

  return { readPaths, writePaths };
}

function enforceWorkspaceBoundary(paths, workspaceRoot, violationMessage) {
  for (const p of paths) {
    if (!isInsideWorkspace(workspaceRoot, p)) {
      throw new ToolingError(ErrorCode.PERMISSION_DENIED, violationMessage);
    }
  }
}

function enforcePermissionPathPolicy({ level, workspaceRoot, bin, readPaths, writePaths }) {
  if (level === 'high') {
    if (bin === 'cp') {
      enforceWorkspaceBoundary(writePaths, workspaceRoot, 'cp destination must stay inside workspace');
      return;
    }

    enforceWorkspaceBoundary(writePaths, workspaceRoot, 'write path escapes workspace');
    return;
  }

  enforceWorkspaceBoundary(
    [...readPaths, ...writePaths],
    workspaceRoot,
    'path escapes workspace under current permission level'
  );
}

function containsKnownDangerousPattern(command) {
  const text = String(command || '');
  if (/\bsudo\b/i.test(text)) return true;
  if (/\brm\s+-rf\s+\/(?:\s|$)/i.test(text)) return true;
  if (/\bshutdown\b/i.test(text) || /\breboot\b/i.test(text)) return true;
  return false;
}

function runProcess({ command, bin, argv, cwd, timeoutMs, context }) {
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs || context.timeoutSec || 20) * 1000);
  const debugEnabled = Boolean(context.bus && typeof context.bus.isDebugMode === 'function' && context.bus.isDebugMode());

  function publishDebug(topic, payload) {
    if (!debugEnabled || typeof context.publishEvent !== 'function') return;
    context.publishEvent(topic, payload);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const startedAt = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, resolvedTimeoutMs);

    proc.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdout += text;
      publishDebug('shell.exec.stdout', {
        command,
        bin,
        chunk: text,
        ts: Date.now()
      });
    });

    proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      stderr += text;
      publishDebug('shell.exec.stderr', {
        command,
        bin,
        chunk: text,
        ts: Date.now()
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(new ToolingError(ErrorCode.RUNTIME_ERROR, error.message || String(error)));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeout);
      publishDebug('shell.exec.exit', {
        command,
        bin,
        code: Number(code),
        signal: signal || null,
        duration_ms: Date.now() - startedAt,
        timed_out: timedOut
      });

      if (timedOut) {
        reject(new ToolingError(ErrorCode.TIMEOUT, `command timeout after ${resolvedTimeoutMs}ms`));
        return;
      }

      const maxChars = Number(context.maxOutputChars || 8000);
      const combined = `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.slice(0, maxChars);
      if (Number(code) !== 0) {
        reject(new ToolingError(ErrorCode.RUNTIME_ERROR, combined || `command failed with exit code ${code}`));
        return;
      }
      resolve(combined || '(no output)');
    });
  });
}

function runShellWithApproval(command, context = {}) {
  const permissionLevel = typeof context.permission_level === 'string'
    ? context.permission_level
    : null;
  const workspaceRoot = path.resolve(context.workspaceRoot || process.cwd());
  const cwd = workspaceRoot;
  const timeoutMs = Math.max(1000, Number(context.timeoutSec || 20) * 1000);

  if (!permissionLevel) {
    throw new ToolingError(ErrorCode.PERMISSION_DENIED, 'shell operators require explicit session permission level');
  }

  const profile = getShellPermissionProfile(permissionLevel);
  if (profile.level !== 'high') {
    throw new ToolingError(
      ErrorCode.PERMISSION_DENIED,
      `shell operators require high permission level (current: ${profile.level})`
    );
  }

  if (containsKnownDangerousPattern(command)) {
    throw new ToolingError(ErrorCode.PERMISSION_DENIED, 'command blocked by shell safety policy');
  }

  const sessionId = getSessionIdFromContext(context);
  const approval = consumeShellApproval({ sessionId, command });
  if (!approval.approved) {
    const pending = createShellApprovalRequest({
      sessionId,
      command,
      reason: 'shell_operators'
    });
    throw new ToolingError(
      ErrorCode.APPROVAL_REQUIRED,
      'shell command requires approval before execution',
      {
        approval_id: pending.approval_id,
        command: pending.command,
        reason: pending.reason,
        scope_options: ['once', 'always']
      }
    );
  }

  return runProcess({
    command,
    bin: '/bin/bash',
    argv: ['-lc', command],
    cwd,
    timeoutMs,
    context
  });
}

function runExec(args, context = {}) {
  const command = String(args.command || '').trim();
  if (!command) throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'command is empty');

  if (hasShellOperators(command)) {
    return runShellWithApproval(command, {
      ...context,
      timeoutSec: Number(args.timeoutSec || context.timeoutSec || 20)
    });
  }

  const [bin, ...argv] = splitCommand(command);
  if (!bin) throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'command parse failed');

  const permissionLevel = typeof context.permission_level === 'string'
    ? context.permission_level
    : null;
  const workspaceRoot = path.resolve(context.workspaceRoot || process.cwd());
  const cwd = workspaceRoot;

  if (permissionLevel) {
    const profile = getShellPermissionProfile(permissionLevel);
    if (profile.allowBins && !profile.allowBins.has(bin)) {
      throw new ToolingError(
        ErrorCode.PERMISSION_DENIED,
        `command not allowed for permission level ${profile.level}: ${bin}`
      );
    }

    const { readPaths, writePaths } = collectPathIntent(bin, argv, cwd);
    enforcePermissionPathPolicy({
      level: profile.level,
      workspaceRoot,
      bin,
      readPaths,
      writePaths
    });
  } else {
    const safeBins = context.safeBins || [];
    if (context.security === 'allowlist' && !safeBins.includes(bin)) {
      throw new ToolingError(ErrorCode.PERMISSION_DENIED, `command not allowed: ${bin}`);
    }
  }

  return runProcess({
    command,
    bin,
    argv,
    cwd,
    timeoutMs: Math.max(1000, Number(args.timeoutSec || context.timeoutSec || 20) * 1000),
    context
  });
}

function runApprove(args, context = {}) {
  const approvalId = String(args.approval_id || '').trim();
  if (!approvalId) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'approval_id is required');
  }

  const scope = String(args.scope || 'once').toLowerCase() === 'always' ? 'always' : 'once';
  const sessionId = getSessionIdFromContext(context);
  const granted = grantShellApproval({
    sessionId,
    approvalId,
    scope
  });

  if (!granted) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, `approval id not found or expired: ${approvalId}`);
  }

  return JSON.stringify({
    status: 'approved',
    approval_id: granted.approval_id,
    command: granted.command,
    scope: granted.scope
  });
}

module.exports = {
  'shell.exec': runExec,
  'shell.approve': runApprove
};
