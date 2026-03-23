const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { getRuntimePaths } = require('./runtimePaths');

const DEFAULT_SKILLS_CONFIG = path.join(getRuntimePaths().configDir, 'skills.yaml');
const DEFAULT_SKILLS_CONFIG_CONTENT = {
  version: 1,
  home: {
    envKey: 'YACHIYO_HOME',
    defaultPath: '~/yachiyo'
  },
  load: {
    workspace: true,
    global: true,
    extraDirs: [],
    watch: true,
    watchDebounceMs: 250
  },
  limits: {
    maxCandidatesPerRoot: 300,
    maxSkillsLoadedPerSource: 200,
    maxSkillsInPrompt: 80,
    maxSkillsPromptChars: 24000,
    maxSkillFileBytes: 262144
  },
  trigger: {
    mode: 'hybrid',
    maxSelectedPerTurn: 2,
    scoreThreshold: 20,
    cooldownMs: 15000,
    rules: {}
  },
  defaults: {
    sessionSkills: {
      enabled: false,
      names: []
    }
  },
  entries: {}
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateSkillsConfig(config) {
  if (!isObject(config)) {
    throw new Error('skills.yaml root must be an object');
  }

  if (config.version !== 1) {
    throw new Error('skills.yaml version must be 1');
  }

  const home = config.home || {};
  if (!isObject(home)) throw new Error('home must be an object');
  if (typeof home.envKey !== 'string' || !home.envKey.trim()) throw new Error('home.envKey must be a non-empty string');
  if (typeof home.defaultPath !== 'string' || !home.defaultPath.trim()) throw new Error('home.defaultPath must be a non-empty string');

  const load = config.load || {};
  if (!isObject(load)) throw new Error('load must be an object');
  if (!Array.isArray(load.extraDirs)) throw new Error('load.extraDirs must be an array');

  const limits = config.limits || {};
  if (!isObject(limits)) throw new Error('limits must be an object');

  const trigger = config.trigger || {};
  if (!isObject(trigger)) throw new Error('trigger must be an object');
  const defaults = config.defaults || {};
  if (!isObject(defaults)) throw new Error('defaults must be an object');
  const sessionSkills = defaults.sessionSkills || {};
  if (!isObject(sessionSkills)) throw new Error('defaults.sessionSkills must be an object');
  if (!Array.isArray(sessionSkills.names || [])) throw new Error('defaults.sessionSkills.names must be an array');

  if (!isObject(config.entries || {})) throw new Error('entries must be an object');
}

function normalizeSkillsConfig(config) {
  validateSkillsConfig(config);

  return {
    version: 1,
    home: {
      envKey: config.home.envKey,
      defaultPath: config.home.defaultPath
    },
    load: {
      workspace: config.load.workspace !== false,
      global: config.load.global !== false,
      extraDirs: (config.load.extraDirs || []).map((v) => String(v).trim()).filter(Boolean),
      watch: config.load.watch !== false,
      watchDebounceMs: Math.max(0, asNumber(config.load.watchDebounceMs, 250))
    },
    limits: {
      maxCandidatesPerRoot: Math.max(1, asNumber(config.limits.maxCandidatesPerRoot, 300)),
      maxSkillsLoadedPerSource: Math.max(1, asNumber(config.limits.maxSkillsLoadedPerSource, 200)),
      maxSkillsInPrompt: Math.max(1, asNumber(config.limits.maxSkillsInPrompt, 80)),
      maxSkillsPromptChars: Math.max(1000, asNumber(config.limits.maxSkillsPromptChars, 24000)),
      maxSkillFileBytes: Math.max(1024, asNumber(config.limits.maxSkillFileBytes, 262144))
    },
    trigger: {
      mode: String(config.trigger.mode || 'hybrid'),
      maxSelectedPerTurn: Math.max(1, asNumber(config.trigger.maxSelectedPerTurn, 2)),
      scoreThreshold: asNumber(config.trigger.scoreThreshold, 20),
      cooldownMs: Math.max(0, asNumber(config.trigger.cooldownMs, 15000)),
      rules: isObject(config.trigger.rules) ? config.trigger.rules : {}
    },
    defaults: {
      sessionSkills: {
        enabled: config.defaults?.sessionSkills?.enabled === true,
        names: (config.defaults?.sessionSkills?.names || []).map((v) => String(v).trim()).filter(Boolean)
      }
    },
    entries: config.entries || {}
  };
}

class SkillConfigStore {
  constructor({ configPath } = {}) {
    this.configPath = configPath || process.env.SKILLS_CONFIG_PATH || DEFAULT_SKILLS_CONFIG;
    this.ensureExists();
  }

  ensureExists() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, YAML.stringify(DEFAULT_SKILLS_CONFIG_CONTENT), 'utf8');
  }

  loadRawYaml() {
    this.ensureExists();
    return fs.readFileSync(this.configPath, 'utf8');
  }

  saveRawYaml(rawYaml) {
    if (typeof rawYaml !== 'string') throw new Error('rawYaml must be a string');
    const parsed = YAML.parse(rawYaml);
    normalizeSkillsConfig(parsed); // 校验
    fs.writeFileSync(this.configPath, rawYaml, 'utf8');
  }

  load() {
    const parsed = YAML.parse(this.loadRawYaml());
    return normalizeSkillsConfig(parsed);
  }
}

module.exports = {
  SkillConfigStore,
  normalizeSkillsConfig,
  validateSkillsConfig
};
