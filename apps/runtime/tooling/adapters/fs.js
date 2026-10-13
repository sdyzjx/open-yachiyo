const fs = require('fs/promises');
const path = require('path');
const { ToolingError, ErrorCode } = require('../errors');

function resolveWorkspacePath(workspaceRoot, targetPath, { allowOutside = false } = {}) {
  const absolute = path.resolve(workspaceRoot, targetPath);
  if (allowOutside) return absolute;
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;
  if (!absolute.startsWith(normalizedRoot) && absolute !== path.resolve(workspaceRoot)) {
    throw new ToolingError(ErrorCode.PERMISSION_DENIED, 'path escapes workspace');
  }
  return absolute;
}

async function writeFile(args, context = {}) {
  const workspaceRoot = context.workspaceRoot || process.cwd();
  const mode = args.mode || 'overwrite';
  const abs = resolveWorkspacePath(workspaceRoot, args.path, {
    allowOutside: context.approval_mode === 'full_access'
  });
  await fs.mkdir(path.dirname(abs), { recursive: true });

  if (mode === 'append') {
    await fs.appendFile(abs, args.content, 'utf8');
  } else {
    await fs.writeFile(abs, args.content, 'utf8');
  }

  return JSON.stringify({ path: abs, mode, bytes: Buffer.byteLength(args.content, 'utf8') });
}

module.exports = {
  'fs.write_file': writeFile
};
