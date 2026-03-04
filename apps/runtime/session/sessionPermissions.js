const SESSION_PERMISSION_LEVELS = Object.freeze(['low', 'medium', 'high']);
const DEFAULT_SESSION_PERMISSION_LEVEL = 'medium';
const DEFAULT_SESSION_WORKSPACE_MODE = 'session';
const DEFAULT_VOICE_AUTO_REPLY_ENABLED = false;

function normalizeWorkspaceSettings(workspace = {}) {
  const rootDir = typeof workspace.root_dir === 'string' && workspace.root_dir.trim()
    ? workspace.root_dir.trim()
    : null;
  return {
    mode: DEFAULT_SESSION_WORKSPACE_MODE,
    root_dir: rootDir
  };
}

function isSessionPermissionLevel(value) {
  return typeof value === 'string' && SESSION_PERMISSION_LEVELS.includes(value);
}

function normalizeSessionPermissionLevel(value, { fallback = DEFAULT_SESSION_PERMISSION_LEVEL } = {}) {
  if (isSessionPermissionLevel(value)) return value;
  return fallback;
}

function normalizeVoiceAutoReplyEnabled(value, { fallback = DEFAULT_VOICE_AUTO_REPLY_ENABLED } = {}) {
  if (value === true || value === false) return value;
  return Boolean(fallback);
}

function buildDefaultSessionSettings() {
  return {
    permission_level: DEFAULT_SESSION_PERMISSION_LEVEL,
    workspace: normalizeWorkspaceSettings(),
    voice_auto_reply_enabled: DEFAULT_VOICE_AUTO_REPLY_ENABLED
  };
}

function normalizeSessionSettings(settings = {}) {
  return {
    permission_level: normalizeSessionPermissionLevel(settings.permission_level),
    workspace: normalizeWorkspaceSettings(settings.workspace),
    voice_auto_reply_enabled: normalizeVoiceAutoReplyEnabled(settings.voice_auto_reply_enabled)
  };
}

function mergeSessionSettings(currentSettings = {}, patch = {}) {
  const current = normalizeSessionSettings(currentSettings);
  const next = {
    ...current
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'permission_level')) {
    next.permission_level = normalizeSessionPermissionLevel(patch.permission_level, { fallback: current.permission_level });
  }

  if (patch.workspace && typeof patch.workspace === 'object' && !Array.isArray(patch.workspace)) {
    next.workspace = normalizeWorkspaceSettings({
      ...current.workspace,
      ...patch.workspace
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'voice_auto_reply_enabled')) {
    next.voice_auto_reply_enabled = normalizeVoiceAutoReplyEnabled(
      patch.voice_auto_reply_enabled,
      { fallback: current.voice_auto_reply_enabled }
    );
  }

  return next;
}

module.exports = {
  SESSION_PERMISSION_LEVELS,
  DEFAULT_SESSION_PERMISSION_LEVEL,
  DEFAULT_SESSION_WORKSPACE_MODE,
  DEFAULT_VOICE_AUTO_REPLY_ENABLED,
  isSessionPermissionLevel,
  normalizeSessionPermissionLevel,
  normalizeVoiceAutoReplyEnabled,
  normalizeWorkspaceSettings,
  buildDefaultSessionSettings,
  normalizeSessionSettings,
  mergeSessionSettings
};
