const fs = require('node:fs/promises');
const path = require('node:path');
const { ErrorCode } = require('../tooling/errors');

function within(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function policyError(message) {
  const error = new Error(message);
  error.code = ErrorCode.PERMISSION_DENIED;
  return error;
}

function imageMimeType(target) {
  const extension = path.extname(target).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp' })[extension] || null;
}

function assertFileAccess(target, current, cwd, { write = false } = {}) {
  const workspaceRoot = path.resolve(current.workspace_root || cwd);
  const approvalMode = current.approval_mode || 'manual';
  const permissionLevel = approvalMode === 'full_access' ? 'high' : current.permission_level || 'high';
  if (approvalMode === 'full_access') return;
  if (write && !within(workspaceRoot, target)) throw policyError('write path escapes workspace');
  if (!write && permissionLevel !== 'high' && !within(workspaceRoot, target)) {
    throw policyError('read path escapes workspace under current permission level');
  }
}

function wrapDefinition(definition, context, cwd) {
  const execute = definition.execute.bind(definition);
  const readOnly = new Set(['read', 'grep', 'find', 'ls']);
  return {
    ...definition,
    executionMode: readOnly.has(definition.name) ? 'parallel' : 'sequential',
    async execute(callId, args, signal, onUpdate, toolContext) {
      try {
        if (readOnly.has(definition.name)) {
          const base = toolContext?.cwd || cwd;
          assertFileAccess(path.resolve(base, args?.path || '.'), context(), cwd);
        }
        return await execute(callId, args, signal, onUpdate, toolContext);
      } catch (error) {
        context().reportToolError?.(callId, {
          code: error?.code || ErrorCode.RUNTIME_ERROR,
          error: String(error?.message || error)
        });
        throw error;
      }
    }
  };
}

function createStandardTools({ sdk, cwd, executor, approvalCoordinator, bus, context }) {
  const current = () => context() || {};
  const readOps = {
    async access(target) {
      assertFileAccess(target, current(), cwd);
      await fs.access(target);
    },
    async readFile(target) {
      assertFileAccess(target, current(), cwd);
      return fs.readFile(target);
    },
    detectImageMimeType: async (target) => imageMimeType(target)
  };
  const writeOps = {
    async mkdir(target) {
      assertFileAccess(target, current(), cwd, { write: true });
      await fs.mkdir(target, { recursive: true });
    },
    async writeFile(target, content) {
      assertFileAccess(target, current(), cwd, { write: true });
      await fs.writeFile(target, content, 'utf8');
    }
  };
  const editOps = {
    ...readOps,
    async access(target) {
      assertFileAccess(target, current(), cwd, { write: true });
      await fs.access(target);
    },
    writeFile: writeOps.writeFile
  };
  const bashOps = {
    async exec(command, _commandCwd, options = {}) {
      options.signal?.throwIfAborted();
      const run = () => executor.execute({ name: 'shell.exec', args: {
        command,
        ...(options.timeout ? { timeoutSec: Math.max(1, Math.min(120, Math.ceil(options.timeout))) } : {})
      } }, {
        ...current(),
        bus,
        signal: options.signal,
        workspaceRoot: current().workspace_root || cwd
      });
      let result = await run();
      result = await approvalCoordinator.coordinate({
        result,
        execute: run,
        context: current(),
        signal: options.signal,
        toolName: 'shell.exec'
      });
      if (!result.ok) {
        const error = new Error(`${result.code ? `[${result.code}] ` : ''}${result.error || 'bash failed'}`);
        error.code = result.code || ErrorCode.RUNTIME_ERROR;
        error.details = result.details;
        throw error;
      }
      options.onData?.(Buffer.from(String(result.result || ''), 'utf8'));
      return { exitCode: 0 };
    }
  };
  const definitions = [
    sdk.createReadToolDefinition(cwd, { operations: readOps }),
    sdk.createBashToolDefinition(cwd, { operations: bashOps, exposeSessionEnvironment: false }),
    sdk.createEditToolDefinition(cwd, { operations: editOps }),
    sdk.createWriteToolDefinition(cwd, { operations: writeOps }),
    sdk.createGrepToolDefinition(cwd),
    sdk.createFindToolDefinition(cwd),
    sdk.createLsToolDefinition(cwd)
  ];
  return definitions.map((definition) => wrapDefinition(definition, current, cwd));
}

module.exports = { createStandardTools, assertFileAccess, within, imageMimeType };
