const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getRuntimePaths } = require('../../skills/runtimePaths');

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dirPath, 0o700); } catch { /* Windows has no Unix mode bits. */ }
}

function writePrivateJson(filePath, value) {
  ensurePrivateDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch { /* Windows has no Unix mode bits. */ }
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows has no Unix mode bits. */ }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function profileId(identity, clientId) {
  return crypto.createHash('sha256')
    .update(`${identity.issuer}\0${clientId}\0${identity.subject}`)
    .digest('hex')
    .slice(0, 24);
}

class ChatGPTCredentialStore {
  constructor({ rootDir } = {}) {
    this.rootDir = path.resolve(rootDir || path.join(getRuntimePaths().dataDir, 'chatgpt-auth'));
    this.profilesDir = path.join(this.rootDir, 'profiles');
    this.hostPath = path.join(this.rootDir, 'host.json');
    this.indexPath = path.join(this.rootDir, 'index.json');
    ensurePrivateDir(this.rootDir);
    ensurePrivateDir(this.profilesDir);
  }

  getHostId() {
    const current = readJson(this.hostPath);
    if (typeof current?.ext_agent_host_id === 'string' && current.ext_agent_host_id.startsWith('urn:uuid:')) {
      return current.ext_agent_host_id;
    }
    const extAgentHostId = `urn:uuid:${crypto.randomUUID()}`;
    writePrivateJson(this.hostPath, { version: 1, ext_agent_host_id: extAgentHostId });
    return extAgentHostId;
  }

  loadIndex() {
    const index = readJson(this.indexPath, {});
    return {
      version: 1,
      active_profile_id: typeof index?.active_profile_id === 'string' ? index.active_profile_id : null,
      profile_ids: Array.isArray(index?.profile_ids) ? index.profile_ids.filter((id) => /^[a-f0-9]{24}$/.test(id)) : []
    };
  }

  saveIndex(index) {
    writePrivateJson(this.indexPath, { version: 1, ...index });
  }

  profilePath(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id || ''))) throw new Error('Invalid ChatGPT profile id');
    return path.join(this.profilesDir, `${id}.json`);
  }

  listProfiles() {
    const index = this.loadIndex();
    return index.profile_ids.map((id) => this.getProfile(id)).filter(Boolean);
  }

  getProfile(id) {
    if (!id) return null;
    return readJson(this.profilePath(id));
  }

  getActiveProfile() {
    return this.getProfile(this.loadIndex().active_profile_id);
  }

  saveProfile(record, { makeActive = true } = {}) {
    const id = record.id || profileId(record, record.client_id);
    const saved = { version: 1, ...record, id };
    writePrivateJson(this.profilePath(id), saved);
    const index = this.loadIndex();
    if (!index.profile_ids.includes(id)) index.profile_ids.push(id);
    if (makeActive) index.active_profile_id = id;
    this.saveIndex(index);
    return saved;
  }

  clearTokens(id) {
    const current = this.getProfile(id);
    if (!current) return null;
    const cleared = { ...current, access_token: null, refresh_token: null, id_token: null,
      expires_at: null, earliest_refresh_at: null, scopes: [], connected: false };
    return this.saveProfile(cleared, { makeActive: this.loadIndex().active_profile_id === id });
  }

  setActive(id) {
    if (!this.getProfile(id)) throw new Error('Unknown ChatGPT profile');
    const index = this.loadIndex();
    index.active_profile_id = id;
    this.saveIndex(index);
  }
}

module.exports = { ChatGPTCredentialStore, profileId, writePrivateJson };
