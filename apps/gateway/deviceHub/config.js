const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const YAML = require('yaml');
const { resolveYachiyoHome } = require('../../runtime/skills/runtimePaths');

function loadConfig({ home = resolveYachiyoHome(), log = console.log } = {}) {
  const file = path.join(home, 'config/device-hub.yaml');
  const config = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || {} : {};
  if (!config.pairing_token) {
    config.pairing_token = randomBytes(24).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, YAML.stringify(config), { mode: 0o600 });
    log(`Device Hub pairing token: ${config.pairing_token}`);
  }
  return { ...config, home, heartbeat_ms: Math.max(100, Number(config.heartbeat_ms) || 15000) };
}

function tokenMatches(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { loadConfig, tokenMatches };
