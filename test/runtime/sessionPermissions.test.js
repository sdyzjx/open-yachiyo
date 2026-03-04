const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SESSION_PERMISSION_LEVELS,
  DEFAULT_SESSION_PERMISSION_LEVEL,
  DEFAULT_SESSION_WORKSPACE_MODE,
  DEFAULT_SESSION_VOICE_AUTO_REPLY_MODE,
  isSessionPermissionLevel,
  normalizeSessionPermissionLevel,
  normalizeVoiceAutoReplyMode,
  normalizeWorkspaceSettings,
  buildDefaultSessionSettings,
  normalizeSessionSettings,
  mergeSessionSettings
} = require('../../apps/runtime/session/sessionPermissions');

test('sessionPermissions exposes expected constants and level validators', () => {
  assert.deepEqual(SESSION_PERMISSION_LEVELS, ['low', 'medium', 'high']);
  assert.equal(DEFAULT_SESSION_PERMISSION_LEVEL, 'high');
  assert.equal(DEFAULT_SESSION_WORKSPACE_MODE, 'session');
  assert.equal(DEFAULT_SESSION_VOICE_AUTO_REPLY_MODE, 'policy');
  assert.equal(isSessionPermissionLevel('low'), true);
  assert.equal(isSessionPermissionLevel('medium'), true);
  assert.equal(isSessionPermissionLevel('high'), true);
  assert.equal(isSessionPermissionLevel('invalid'), false);
});

test('normalizeSessionPermissionLevel falls back to configured default', () => {
  assert.equal(normalizeSessionPermissionLevel('high'), 'high');
  assert.equal(normalizeSessionPermissionLevel('invalid'), 'high');
  assert.equal(normalizeSessionPermissionLevel(undefined, { fallback: 'low' }), 'low');
  assert.equal(normalizeVoiceAutoReplyMode('force_on'), 'force_on');
  assert.equal(normalizeVoiceAutoReplyMode('invalid'), 'policy');
});

test('workspace and session settings normalization keeps stable shape', () => {
  assert.deepEqual(normalizeWorkspaceSettings(), {
    mode: 'session',
    root_dir: null
  });

  assert.deepEqual(normalizeWorkspaceSettings({ root_dir: '  /tmp/a  ' }), {
    mode: 'session',
    root_dir: '/tmp/a'
  });

  assert.deepEqual(buildDefaultSessionSettings(), {
    permission_level: 'high',
    workspace: {
      mode: 'session',
      root_dir: null
    },
    voice_auto_reply_enabled: false,
    voice_auto_reply_mode: 'policy'
  });

  assert.deepEqual(normalizeSessionSettings({ permission_level: 'high' }), {
    permission_level: 'high',
    workspace: {
      mode: 'session',
      root_dir: null
    },
    voice_auto_reply_enabled: false,
    voice_auto_reply_mode: 'policy'
  });
});

test('mergeSessionSettings patches only supported keys and preserves normalized values', () => {
  const merged = mergeSessionSettings(
    {
      permission_level: 'high',
      workspace: {
        mode: 'session',
        root_dir: '/tmp/workspace-a'
      },
      voice_auto_reply_enabled: false,
      voice_auto_reply_mode: 'policy'
    },
    {
      permission_level: 'high',
      workspace: {
        root_dir: ' /tmp/workspace-b '
      },
      voice_auto_reply_enabled: true,
      voice_auto_reply_mode: 'force_on',
      ignored_key: 'ignored'
    }
  );

  assert.deepEqual(merged, {
    permission_level: 'high',
    workspace: {
      mode: 'session',
      root_dir: '/tmp/workspace-b'
    },
    voice_auto_reply_enabled: true,
    voice_auto_reply_mode: 'force_on'
  });

  const invalidPatch = mergeSessionSettings(merged, { permission_level: 'invalid' });
  assert.equal(invalidPatch.permission_level, 'high');
  assert.equal(invalidPatch.voice_auto_reply_enabled, true);
  assert.equal(invalidPatch.voice_auto_reply_mode, 'force_on');
});
