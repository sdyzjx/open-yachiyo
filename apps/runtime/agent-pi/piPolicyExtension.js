const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { getShellPermissionProfile } = require('../security/sessionPermissionPolicy');

const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);
const WRITE_TOOLS = new Set(['edit', 'write']);

function within(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveToolPath(raw, cwd) {
  const value = String(raw || '.');
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(cwd, value);
}

function splitCommand(command) {
  const parts = String(command || '').match(/(?:"[^"]*"|'[^']*'|\S)+/g) || [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function hasShellOperators(command) {
  return /(?:\|\||&&|[;&|><`$()])/.test(String(command || ''));
}

function dangerousCommandReason(command) {
  const text = String(command || '');
  if (/\bsudo\b/i.test(text)) return 'sudo is blocked by Pi command policy';
  if (/\brm\s+(?:[^\n]*\s)?-[^\n]*r[^\n]*f[^\n]*\s+\/(?:\s|$)/i.test(text)) {
    return 'recursive deletion of the filesystem root is blocked by Pi command policy';
  }
  if (/\b(?:shutdown|reboot|halt|poweroff)\b/i.test(text)) {
    return 'host power control is blocked by Pi command policy';
  }
  if (/\b(?:chmod|chown)\b[^\n]*\b777\b/i.test(text)) {
    return 'world-writable permission changes are blocked by Pi command policy';
  }
  return null;
}

function nonOptionArgs(argv) {
  return argv.filter((item) => item && !item.startsWith('-'));
}

function resolvePathToken(cwd, token) {
  if (!token || token === '-' || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return null;
  return resolveToolPath(token, cwd);
}

function collectSimpleCommandPaths(bin, argv, cwd) {
  const read = [];
  const write = [];
  if (['ls', 'cat', 'head', 'tail', 'wc', 'stat'].includes(bin)) {
    for (const arg of nonOptionArgs(argv)) read.push(resolvePathToken(cwd, arg));
  } else if (bin === 'grep') {
    for (const arg of nonOptionArgs(argv).slice(1)) read.push(resolvePathToken(cwd, arg));
  } else if (bin === 'find') {
    const [scanPath] = nonOptionArgs(argv);
    if (scanPath) read.push(resolvePathToken(cwd, scanPath));
  } else if (['mkdir', 'touch', 'rm'].includes(bin)) {
    for (const arg of nonOptionArgs(argv)) write.push(resolvePathToken(cwd, arg));
  } else if (bin === 'cp') {
    const args = nonOptionArgs(argv);
    for (const source of args.slice(0, -1)) read.push(resolvePathToken(cwd, source));
    if (args.length) write.push(resolvePathToken(cwd, args.at(-1)));
  } else if (bin === 'mv') {
    for (const arg of nonOptionArgs(argv)) write.push(resolvePathToken(cwd, arg));
  } else if (bin === 'curl') {
    for (let index = 0; index < argv.length; index += 1) {
      if (['-o', '--output'].includes(argv[index]) && argv[index + 1]) {
        write.push(resolvePathToken(cwd, argv[index + 1]));
      }
      if (['-K', '--config'].includes(argv[index]) && argv[index + 1]) {
        read.push(resolvePathToken(cwd, argv[index + 1]));
      }
    }
  }
  return { read: read.filter(Boolean), write: write.filter(Boolean) };
}

function pathPolicyReason({ current, cwd, read = [], write = [] }) {
  const workspace = path.resolve(current.workspace_root || cwd);
  const approvalMode = current.approval_mode || 'manual';
  const level = approvalMode === 'full_access' ? 'high' : current.permission_level || 'high';
  if (approvalMode === 'full_access') return null;
  const deniedWrites = write.find((target) => !within(workspace, target));
  if (deniedWrites) return `write path escapes workspace: ${deniedWrites}`;
  if (level !== 'high') {
    const deniedRead = read.find((target) => !within(workspace, target));
    if (deniedRead) return `read path escapes workspace under ${level} permission: ${deniedRead}`;
  }
  return null;
}

function fileToolPolicyReason(event, current, cwd) {
  if (!READ_TOOLS.has(event.toolName) && !WRITE_TOOLS.has(event.toolName)) return null;
  const target = resolveToolPath(event.input?.path || '.', cwd);
  return pathPolicyReason({
    current,
    cwd,
    ...(READ_TOOLS.has(event.toolName) ? { read: [target] } : { write: [target] })
  });
}

function bashPolicyReason(command, current, cwd) {
  const dangerous = dangerousCommandReason(command);
  if (dangerous) return dangerous;
  const [bin, ...argv] = splitCommand(command);
  if (!bin) return 'empty command blocked by Pi command policy';
  const approvalMode = current.approval_mode || 'manual';
  const level = approvalMode === 'full_access' ? 'high' : current.permission_level || 'high';
  const profile = getShellPermissionProfile(level);
  if (profile.allowBins && !profile.allowBins.has(bin)) {
    return `command not allowed for ${level} permission: ${bin}`;
  }
  if (level !== 'high' && hasShellOperators(command)) {
    return `shell operators require high permission (current: ${level})`;
  }
  const paths = collectSimpleCommandPaths(bin, argv, cwd);
  return pathPolicyReason({ current, cwd, ...paths });
}

function createPiPolicyExtension({ cwd, context, approvalCoordinator }) {
  const persistentApprovals = new Set();
  return (pi) => {
    pi.on('tool_call', async (event, extensionContext) => {
      const current = context() || {};
      const effectiveCwd = extensionContext.cwd || cwd;
      const fileReason = fileToolPolicyReason(event, current, effectiveCwd);
      if (fileReason) return { block: true, reason: fileReason };
      if (event.toolName !== 'bash') return undefined;
      const command = String(event.input?.command || '').trim();
      const policyReason = bashPolicyReason(command, current, effectiveCwd);
      if (policyReason) return { block: true, reason: policyReason };
      const approvalMode = current.approval_mode || 'manual';
      if (approvalMode === 'auto_approve' || approvalMode === 'full_access') return undefined;
      const sessionId = String(current.session_id || '__global__');
      const fingerprint = crypto.createHash('sha256').update(`${sessionId}\0bash\0${command}`).digest('hex');
      if (persistentApprovals.has(fingerprint)) return undefined;
      const decision = await approvalCoordinator.requestFrontendDecision({
        sessionId,
        signal: extensionContext.signal,
        toolName: 'bash',
        command,
        reason: 'pi_bash_command'
      });
      if (decision.approved && decision.scope === 'always') persistentApprovals.add(fingerprint);
      if (!decision.approved) {
        return { block: true, reason: `Pi command approval ${decision.reason || 'denied'}` };
      }
      return undefined;
    });
  };
}

module.exports = {
  createPiPolicyExtension,
  within,
  dangerousCommandReason,
  fileToolPolicyReason,
  bashPolicyReason,
  collectSimpleCommandPaths
};
