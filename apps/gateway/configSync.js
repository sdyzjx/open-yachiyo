const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const {
  parseJsonWithComments,
  serializeDesktopLive2dUiConfig,
  syncDesktopLive2dMissingDefaults,
  DEFAULT_UI_CONFIG
} = require('../desktop-live2d/main/config');
const { getRuntimePaths } = require('../runtime/skills/runtimePaths');
const { DEFAULT_CONFIG: DEFAULT_PROVIDER_CONFIG } = require('../runtime/config/providerConfigStore');
const { DEFAULT_SKILLS_CONFIG_CONTENT } = require('../runtime/skills/skillConfigStore');
const { DEFAULT_CONFIG: DEFAULT_PERSONA_CONFIG } = require('../runtime/persona/personaConfigStore');
const { defaultPolicy } = require('../runtime/tooling/voice/policy');

const REPO_TOOLS_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'tools.yaml');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (isPlainObject(value)) {
    const cloned = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = cloneValue(nestedValue);
    }
    return cloned;
  }
  return value;
}

function fillMissingWithDefaults(target, defaults, {
  pathPrefix = '',
  opaquePaths = new Set(),
  addedPaths = []
} = {}) {
  if (!isPlainObject(defaults)) {
    return {
      value: target,
      addedPaths
    };
  }

  const nextValue = isPlainObject(target) ? { ...target } : {};

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(nextValue, key) || nextValue[key] === undefined) {
      nextValue[key] = cloneValue(defaultValue);
      addedPaths.push(nextPath);
      continue;
    }
    if (opaquePaths.has(nextPath)) {
      continue;
    }
    if (isPlainObject(defaultValue) && isPlainObject(nextValue[key])) {
      nextValue[key] = fillMissingWithDefaults(nextValue[key], defaultValue, {
        pathPrefix: nextPath,
        opaquePaths,
        addedPaths
      }).value;
    }
  }

  return {
    value: nextValue,
    addedPaths
  };
}

function syncYamlObjectMissingDefaults(currentRaw, defaults, options = {}) {
  return fillMissingWithDefaults(currentRaw, defaults, options);
}

function syncProvidersMissingDefaults(configPath) {
  const currentRaw = fs.existsSync(configPath)
    ? (YAML.parse(fs.readFileSync(configPath, 'utf8')) || {})
    : {};
  const safeCurrent = isPlainObject(currentRaw) ? { ...currentRaw } : {};
  const addedPaths = [];

  if (!Object.prototype.hasOwnProperty.call(safeCurrent, 'active_provider') || safeCurrent.active_provider === undefined) {
    const providerNames = isPlainObject(safeCurrent.providers) ? Object.keys(safeCurrent.providers) : [];
    safeCurrent.active_provider = providerNames[0] || DEFAULT_PROVIDER_CONFIG.active_provider;
    addedPaths.push('active_provider');
  }

  const { value: nextRaw } = syncYamlObjectMissingDefaults(safeCurrent, DEFAULT_PROVIDER_CONFIG, {
    opaquePaths: new Set(['providers']),
    addedPaths
  });
  const nextYaml = YAML.stringify(nextRaw);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextYaml, 'utf8');
  return {
    nextRaw,
    nextText: nextYaml,
    addedPaths
  };
}

function syncSkillsMissingDefaults(configPath) {
  const currentRaw = fs.existsSync(configPath)
    ? (YAML.parse(fs.readFileSync(configPath, 'utf8')) || {})
    : {};
  const { value: nextRaw, addedPaths } = syncYamlObjectMissingDefaults(currentRaw, DEFAULT_SKILLS_CONFIG_CONTENT);
  const nextYaml = YAML.stringify(nextRaw);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextYaml, 'utf8');
  return {
    nextRaw,
    nextText: nextYaml,
    addedPaths
  };
}

function syncPersonaMissingDefaults(configPath) {
  const currentRaw = fs.existsSync(configPath)
    ? (YAML.parse(fs.readFileSync(configPath, 'utf8')) || {})
    : {};
  const { value: nextRaw, addedPaths } = syncYamlObjectMissingDefaults(currentRaw, DEFAULT_PERSONA_CONFIG);
  const nextYaml = YAML.stringify(nextRaw);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextYaml, 'utf8');
  return {
    nextRaw,
    nextText: nextYaml,
    addedPaths
  };
}

function syncVoicePolicyMissingDefaults(configPath) {
  const currentRaw = fs.existsSync(configPath)
    ? (YAML.parse(fs.readFileSync(configPath, 'utf8')) || {})
    : {};
  const defaults = {
    voice_policy: defaultPolicy()
  };
  const { value: nextRaw, addedPaths } = syncYamlObjectMissingDefaults(currentRaw, defaults);
  const nextYaml = YAML.stringify(nextRaw);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextYaml, 'utf8');
  return {
    nextRaw,
    nextText: nextYaml,
    addedPaths
  };
}

function loadToolsDefaults() {
  if (!fs.existsSync(REPO_TOOLS_CONFIG_PATH)) {
    return {};
  }
  return YAML.parse(fs.readFileSync(REPO_TOOLS_CONFIG_PATH, 'utf8')) || {};
}

function syncToolsMissingDefaults(configPath) {
  const currentRaw = fs.existsSync(configPath)
    ? (YAML.parse(fs.readFileSync(configPath, 'utf8')) || {})
    : {};
  const defaults = loadToolsDefaults();
  const { value: nextRaw, addedPaths } = syncYamlObjectMissingDefaults(currentRaw, defaults, {
    opaquePaths: new Set(['tools'])
  });
  const nextYaml = YAML.stringify(nextRaw);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextYaml, 'utf8');
  return {
    nextRaw,
    nextText: nextYaml,
    addedPaths
  };
}

function syncDesktopLive2dDefaults(configPath) {
  const { nextRaw, addedPaths } = syncDesktopLive2dMissingDefaults(configPath, {
    defaults: DEFAULT_UI_CONFIG
  });
  return {
    nextRaw,
    nextText: serializeDesktopLive2dUiConfig(nextRaw),
    addedPaths
  };
}

function getConfigSyncTargets({ env = process.env } = {}) {
  const runtimePaths = getRuntimePaths({ env });
  return [
    {
      id: 'providers',
      file: 'providers.yaml',
      path: path.join(runtimePaths.configDir, 'providers.yaml'),
      sync: syncProvidersMissingDefaults
    },
    {
      id: 'tools',
      file: 'tools.yaml',
      path: REPO_TOOLS_CONFIG_PATH,
      sync: syncToolsMissingDefaults
    },
    {
      id: 'skills',
      file: 'skills.yaml',
      path: path.join(runtimePaths.configDir, 'skills.yaml'),
      sync: syncSkillsMissingDefaults
    },
    {
      id: 'persona',
      file: 'persona.yaml',
      path: path.join(runtimePaths.configDir, 'persona.yaml'),
      sync: syncPersonaMissingDefaults
    },
    {
      id: 'voice-policy',
      file: 'voice-policy.yaml',
      path: path.resolve(process.cwd(), 'config', 'voice-policy.yaml'),
      sync: syncVoicePolicyMissingDefaults
    },
    {
      id: 'desktop-live2d',
      file: 'desktop-live2d.json',
      path: path.join(runtimePaths.configDir, 'desktop-live2d.json'),
      sync: syncDesktopLive2dDefaults
    }
  ];
}

function syncAllConfigMissingDefaults({ env = process.env } = {}) {
  const results = [];
  for (const target of getConfigSyncTargets({ env })) {
    const synced = target.sync(target.path);
    results.push({
      id: target.id,
      file: target.file,
      path: target.path,
      addedPaths: synced.addedPaths,
      addedCount: synced.addedPaths.length,
      text: synced.nextText
    });
  }
  return results;
}

module.exports = {
  fillMissingWithDefaults,
  syncYamlObjectMissingDefaults,
  syncProvidersMissingDefaults,
  syncToolsMissingDefaults,
  syncSkillsMissingDefaults,
  syncPersonaMissingDefaults,
  syncVoicePolicyMissingDefaults,
  syncDesktopLive2dDefaults,
  syncAllConfigMissingDefaults,
  getConfigSyncTargets
};
