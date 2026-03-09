const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { getRuntimePaths } = require('../skills/runtimePaths');

const DEFAULT_PATH = path.join(getRuntimePaths().configDir, 'persona.yaml');
const DEFAULT_CONFIG = {
  version: 1,
  defaults: {
    profile: 'yachiyo',
    mode: 'hybrid',
    injectEnabled: true,
    maxContextChars: 1500,
    sharedAcrossSessions: true
  },
  source: {
    preferredRoot: '.',
    allowWorkspaceOverride: false
  },
  modes: {
    rational: {
      style: 'concise, structured, technical'
    },
    idol: {
      style: 'warm, expressive, encouraging'
    },
    hybrid: {
      style: 'balanced rational(60) poetic(40)'
    },
    strict: {
      style: 'minimal emotion, high precision'
    }
  },
  writeback: {
    enabled: true,
    explicitOnly: false,
    minSignals: 3
  }
};

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('persona.yaml root must be object');
  if (raw.version !== 1) throw new Error('persona.yaml version must be 1');

  const defaults = raw.defaults || {};
  const source = raw.source || {};

  return {
    version: 1,
    defaults: {
      profile: String(defaults.profile || 'yachiyo'),
      mode: String(defaults.mode || 'hybrid'),
      injectEnabled: defaults.injectEnabled !== false,
      maxContextChars: Math.max(256, Number(defaults.maxContextChars) || 1500),
      sharedAcrossSessions: defaults.sharedAcrossSessions !== false
    },
    source: {
      preferredRoot: String(source.preferredRoot || '.'),
      allowWorkspaceOverride: source.allowWorkspaceOverride === true
    },
    modes: raw.modes || {},
    writeback: {
      enabled: raw.writeback?.enabled !== false,
      explicitOnly: raw.writeback?.explicitOnly === true,
      minSignals: Math.max(1, Number(raw.writeback?.minSignals) || 3)
    }
  };
}

class PersonaConfigStore {
  constructor({ configPath } = {}) {
    this.configPath = configPath || process.env.PERSONA_CONFIG_PATH || DEFAULT_PATH;
    this.ensureExists();
  }

  ensureExists() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, YAML.stringify(DEFAULT_CONFIG), 'utf8');
  }

  loadRawYaml() {
    this.ensureExists();
    return fs.readFileSync(this.configPath, 'utf8');
  }

  saveRawYaml(rawYaml) {
    if (typeof rawYaml !== 'string') throw new Error('rawYaml must be a string');
    const parsed = YAML.parse(rawYaml);
    normalizeConfig(parsed); // 校验
    fs.writeFileSync(this.configPath, rawYaml, 'utf8');
  }

  load() {
    this.ensureExists();
    const raw = fs.readFileSync(this.configPath, 'utf8');
    return normalizeConfig(YAML.parse(raw));
  }
}

module.exports = { PersonaConfigStore, normalizeConfig, DEFAULT_CONFIG };
