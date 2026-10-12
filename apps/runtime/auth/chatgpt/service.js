const crypto = require('node:crypto');
const http = require('node:http');
const { normalizeProviderConfig } = require('../../config/providerConfigStore');
const { ChatGPTCredentialStore } = require('./credentialStore');
const { ISSUER, verifyIdToken } = require('./oidc');

const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
const RESOURCE = 'https://api.openai.com/v1';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const CALLBACK_PATH = '/auth/callback';
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

function randomValue(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email || null,
    name: profile.name || null,
    connected: Boolean(profile.connected && profile.access_token && profile.refresh_token),
    plan_usage_enabled: Array.isArray(profile.scopes) && profile.scopes.includes(DIRECT_SCOPE),
    expires_at: profile.expires_at || null
  };
}

function safeError(error) {
  const message = String(error?.message || error || 'Unknown ChatGPT error');
  return message.replace(/(?:access|refresh|id)_token[^\s]*/gi, '[redacted]').slice(0, 600);
}

function parseScopes(value, fallback = []) {
  if (typeof value !== 'string') return [...fallback];
  return value.trim().split(/\s+/).filter(Boolean);
}

class ChatGPTOAuthError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class ChatGPTAuthService {
  constructor({
    store = new ChatGPTCredentialStore(),
    providerStore,
    fetchImpl = (...args) => fetch(...args),
    verifyIdentity = verifyIdToken,
    serverFactory = () => http.createServer(),
    attemptTtlMs = 5 * 60 * 1000,
    now = () => Date.now(),
    onConfigChange = () => {}
  } = {}) {
    this.store = store;
    this.providerStore = providerStore;
    this.fetchImpl = fetchImpl;
    this.verifyIdentity = verifyIdentity;
    this.serverFactory = serverFactory;
    this.attemptTtlMs = attemptTtlMs;
    this.now = now;
    this.onConfigChange = onConfigChange;
    this.pending = null;
    this.lastError = null;
    this.refreshes = new Map();
  }

  status() {
    const active = this.store.getActiveProfile();
    const profiles = this.store.listProfiles().map(publicProfile);
    const activeProfile = publicProfile(active);
    return {
      connected: Boolean(activeProfile?.connected),
      plan_usage_enabled: Boolean(activeProfile?.plan_usage_enabled),
      active_profile: activeProfile,
      profiles,
      pending: this.pending ? {
        attempt_id: this.pending.id,
        state: this.pending.state,
        started_at: new Date(this.pending.startedAt).toISOString()
      } : null,
      error: this.lastError
    };
  }

  async start({ profileId } = {}) {
    if (this.pending) throw new Error('A ChatGPT authorization attempt is already active');
    const selected = profileId ? this.store.getProfile(profileId) : null;
    if (profileId && !selected) throw new Error('Unknown ChatGPT profile');

    const verifier = randomValue(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = randomValue();
    const nonce = randomValue();
    const id = crypto.randomUUID();
    const attempt = {
      id, state: 'waiting', startedAt: this.now(), server: null, verifier, challenge, oauthState: state,
      nonce, redirectUri: null, profileId: selected?.id || null, clientId: selected?.client_id || DYNAMIC_CLIENT_ID,
      abortController: new AbortController(), cancelled: false,
      timer: null
    };
    this.pending = attempt;
    this.lastError = null;
    attempt.timer = setTimeout(() => this.expireAttempt(id), this.attemptTtlMs);
    attempt.timer.unref?.();
    try {
      const server = this.serverFactory();
      attempt.server = server;
      server.on('request', (req, res) => { void this.handleCallback(attempt, req, res); });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port: 0, host: '127.0.0.1', signal: attempt.abortController.signal }, () => {
          server.removeListener('error', reject);
          const address = server.address();
          attempt.redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
          resolve();
        });
      });
      if (attempt.cancelled || this.pending?.id !== id) throw new Error('ChatGPT authorization attempt was cancelled');
    } catch (error) {
      attempt.cancelled = true;
      attempt.abortController.abort();
      this.closeAttempt(attempt);
      throw error;
    }

    const url = new URL(AUTHORIZE_URL);
    const params = {
      client_id: attempt.clientId,
      ext_agent_host_id: this.store.getHostId(),
      response_type: 'code',
      redirect_uri: attempt.redirectUri,
      resource: RESOURCE,
      scope: SCOPE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge
    };
    if (selected) {
      if (selected.email) params.login_hint = selected.email;
    } else {
      params.agent_name_hint = 'Yachiyo';
    }
    url.search = new URLSearchParams(params).toString();
    return { authorization_url: url.toString(), attempt_id: id };
  }

  closeAttempt(attempt) {
    clearTimeout(attempt?.timer);
    if (attempt?.server?.listening) attempt.server.close();
    if (this.pending?.id === attempt?.id) this.pending = null;
  }

  expireAttempt(id) {
    if (this.pending?.id !== id) return;
    const attempt = this.pending;
    attempt.cancelled = true;
    attempt.abortController.abort();
    this.lastError = 'ChatGPT authorization timed out';
    this.closeAttempt(attempt);
  }

  cancel(attemptId) {
    if (!this.pending || this.pending.id !== attemptId) throw new Error('ChatGPT authorization attempt not found');
    this.pending.cancelled = true;
    this.pending.abortController.abort();
    this.closeAttempt(this.pending);
    this.lastError = null;
  }

  async handleCallback(attempt, req, res) {
    const url = new URL(req.url || '/', attempt.redirectUri);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    if (this.pending?.id !== attempt.id || attempt.state !== 'waiting') {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization attempt is no longer active.');
      return;
    }
    if (url.searchParams.get('state') !== attempt.oauthState) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('OAuth state mismatch.');
      return;
    }
    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const callbackClientId = url.searchParams.get('client_id');
    if (oauthError || !code) {
      this.lastError = oauthError ? `ChatGPT authorization failed: ${oauthError}` : 'Missing authorization code';
      this.closeAttempt(attempt);
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('ChatGPT was not connected.');
      return;
    }
    let issuedClientId = attempt.clientId;
    if (attempt.clientId === DYNAMIC_CLIENT_ID) {
      if (!callbackClientId || callbackClientId === DYNAMIC_CLIENT_ID) {
        this.lastError = 'Issued ChatGPT client ID was missing';
        this.closeAttempt(attempt);
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Issued client ID missing.');
        return;
      }
      issuedClientId = callbackClientId;
    } else if (callbackClientId && callbackClientId !== attempt.clientId) {
      this.lastError = 'Issued ChatGPT client ID did not match the registered profile';
      this.closeAttempt(attempt);
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Issued client ID mismatch.');
      return;
    }

    attempt.state = 'completing';
    if (attempt.server.listening) attempt.server.close();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<!doctype html><meta charset="utf-8"><title>Yachiyo</title><p>ChatGPT authorization received. You can close this window.</p>');
    try {
      const token = await this.requestToken({
        grant_type: 'authorization_code', client_id: issuedClientId, code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE
      }, attempt.abortController.signal);
      if (attempt.cancelled) throw new Error('ChatGPT authorization was cancelled');
      const idToken = String(token.id_token || '');
      if (!idToken) throw new Error('OpenAI token response did not include an ID token');
      const identity = await this.verifyIdentity(idToken, {
        clientId: issuedClientId, nonce: attempt.nonce, fetchImpl: this.fetchImpl, now: this.now
      });
      if (attempt.cancelled) throw new Error('ChatGPT authorization was cancelled');
      const previous = attempt.profileId ? this.store.getProfile(attempt.profileId) : null;
      if (previous && (previous.subject !== identity.sub || previous.issuer !== identity.iss)) {
        throw new Error('The returned ChatGPT identity did not match the selected profile');
      }
      const scopes = parseScopes(token.scope);
      const expiresIn = Number(token.expires_in);
      if (!token.access_token || !token.refresh_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('OpenAI token response was incomplete');
      }
      const record = this.store.saveProfile({
        id: previous?.id,
        issuer: identity.iss || ISSUER,
        subject: identity.sub,
        email: identity.email || previous?.email || null,
        name: identity.name || previous?.name || null,
        client_id: issuedClientId,
        ext_agent_host_id: this.store.getHostId(),
        id_token: idToken,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type || 'Bearer',
        expires_at: new Date(this.now() + expiresIn * 1000).toISOString(),
        earliest_refresh_at: token.earliest_refresh_at || null,
        scopes,
        connected: true,
        saved_at: new Date(this.now()).toISOString()
      });
      if (!scopes.includes(DIRECT_SCOPE)) {
        this.lastError = 'ChatGPT plan usage permission was not granted';
      } else {
        this.lastError = null;
        await this.refreshModels({ profileId: record.id });
      }
    } catch (error) {
      this.lastError = safeError(error);
    } finally {
      this.closeAttempt(attempt);
    }
  }

  async requestToken(fields, signal) {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let detail = response.statusText || 'request failed';
      let code = null;
      try {
        const parsed = JSON.parse(text);
        code = parsed.error?.code || parsed.error || parsed.code || null;
        if (typeof code === 'string' && /^[a-z0-9_.-]{1,100}$/i.test(code)) detail = code;
      } catch { /* keep status text; never surface an arbitrary response body */ }
      throw new ChatGPTOAuthError(`OpenAI OAuth token request failed (${response.status}): ${detail}`, { code, status: response.status });
    }
    return response.json();
  }

  async getAccessToken({ profileId, required = true } = {}) {
    const profile = profileId ? this.store.getProfile(profileId) : this.store.getActiveProfile();
    if (!profile?.connected || !profile.access_token || !profile.refresh_token) {
      if (required) throw new Error('ChatGPT is not connected');
      return null;
    }
    if (!profile.scopes?.includes(DIRECT_SCOPE)) {
      if (required) throw new Error('ChatGPT plan usage permission is not enabled');
      return null;
    }
    const expiry = Date.parse(profile.expires_at || '');
    if (Number.isFinite(expiry) && expiry - this.now() > EXPIRY_MARGIN_MS) return profile.access_token;
    return this.refreshAccessToken(profile.id);
  }

  async refreshAccessToken(profileId) {
    if (this.refreshes.has(profileId)) return this.refreshes.get(profileId);
    const pending = (async () => {
      const profile = this.store.getProfile(profileId);
      if (!profile?.refresh_token || !profile.client_id) throw new Error('ChatGPT profile cannot be refreshed');
      let token;
      try {
        token = await this.requestToken({
          grant_type: 'refresh_token', client_id: profile.client_id,
          refresh_token: profile.refresh_token, resource: RESOURCE
        });
      } catch (error) {
        const terminal = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
          'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
        if (terminal.has(error?.code)) this.store.clearTokens(profileId);
        throw error;
      }
      const expiresIn = Number(token.expires_in);
      if (!token.access_token || !token.refresh_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('OpenAI refresh response was incomplete');
      }
      const scopes = parseScopes(token.scope, profile.scopes);
      if (!scopes.includes(DIRECT_SCOPE)) throw new Error('ChatGPT plan usage permission is no longer enabled');
      const saved = this.store.saveProfile({ ...profile,
        access_token: token.access_token, refresh_token: token.refresh_token,
        id_token: profile.id_token,
        expires_at: new Date(this.now() + expiresIn * 1000).toISOString(),
        earliest_refresh_at: token.earliest_refresh_at || null,
        scopes, saved_at: new Date(this.now()).toISOString(), connected: true
      }, { makeActive: this.store.loadIndex().active_profile_id === profileId });
      return saved.access_token;
    })().finally(() => this.refreshes.delete(profileId));
    this.refreshes.set(profileId, pending);
    return pending;
  }

  async refreshModels({ profileId } = {}) {
    const profile = profileId ? this.store.getProfile(profileId) : this.store.getActiveProfile();
    if (!profile) throw new Error('ChatGPT is not connected');
    const request = (token) => this.fetchImpl(`${RESOURCE}/models`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
    });
    let response = await request(await this.getAccessToken({ profileId: profile.id }));
    if (response.status === 401) {
      await response.body?.cancel?.();
      response = await request(await this.refreshAccessToken(profile.id));
    }
    if (!response.ok) {
      throw new Error(`ChatGPT model catalog request failed (${response.status})`);
    }
    const body = await response.json();
    const models = (Array.isArray(body?.models) ? body.models : [])
      .filter((model) => model?.visibility === 'list' && typeof model.slug === 'string' && model.slug)
      .map((model) => ({ slug: model.slug, display_name: model.display_name || model.slug }));
    if (!models.length) throw new Error('ChatGPT model catalog did not include visible models');
    this.saveModelCatalog(models);
    this.store.setActive(profile.id);
    return models;
  }

  saveModelCatalog(models) {
    if (!this.providerStore) return;
    const raw = JSON.parse(JSON.stringify(this.providerStore.load()));
    raw.providers ||= {};
    if (raw.providers.chatgpt && raw.providers.chatgpt.type !== 'openai_chatgpt_plan') {
      throw new Error('Provider key "chatgpt" is already used by another provider');
    }
    raw.providers.chatgpt = {
      type: 'openai_chatgpt_plan', display_name: 'ChatGPT plan',
      base_url: RESOURCE, requires_api_key: false,
      models: models.map((model) => ({ id: model.slug, name: model.display_name }))
    };
    const known = new Set();
    const normalized = normalizeProviderConfig(raw);
    for (const [key, provider] of Object.entries(normalized.providers)) {
      for (const model of provider.models || []) known.add(`${key}/${model.id}`);
    }
    const firstChatGPT = `chatgpt/${models[0].slug}`;
    if (String(raw.active_model || '').startsWith('chatgpt/') && !known.has(raw.active_model)) raw.active_model = firstChatGPT;
    for (const field of ['enabled_models', 'fallback_models']) {
      if (Array.isArray(raw[field])) raw[field] = raw[field].filter((ref) => known.has(ref));
    }
    if (raw.roles && typeof raw.roles === 'object') {
      raw.roles = Object.fromEntries(Object.entries(raw.roles).filter(([, ref]) => known.has(ref)));
    }
    raw.version = 2;
    this.providerStore.save(raw);
    this.onConfigChange('providers.yaml');
  }

  async signOut({ profileId } = {}) {
    const profile = profileId ? this.store.getProfile(profileId) : this.store.getActiveProfile();
    if (!profile) throw new Error('ChatGPT profile not found');
    let revoked = false;
    if (profile.refresh_token && profile.client_id) {
      try {
        const discovery = await this.fetchImpl(DISCOVERY_URL, { headers: { accept: 'application/json' } });
        if (!discovery.ok) throw new Error('OpenAI discovery request failed');
        const revocationUrl = new URL((await discovery.json()).revocation_endpoint);
        if (revocationUrl.protocol !== 'https:' || revocationUrl.hostname !== 'auth.openai.com') {
          throw new Error('OpenAI revocation endpoint is invalid');
        }
        const response = await this.fetchImpl(revocationUrl.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: profile.refresh_token, token_type_hint: 'refresh_token', client_id: profile.client_id })
        });
        revoked = response.ok;
      } catch {
        revoked = false;
      }
    }
    this.store.clearTokens(profile.id);
    this.lastError = revoked ? null : 'Signed out locally; remote revocation was not confirmed';
    return { profile_id: profile.id, revoked };
  }

  close() {
    if (this.pending) {
      this.pending.cancelled = true;
      this.pending.abortController.abort();
      this.closeAttempt(this.pending);
    }
  }
}

module.exports = {
  AUTHORIZE_URL, TOKEN_URL, DISCOVERY_URL, RESOURCE, DIRECT_SCOPE,
  ChatGPTAuthService, ChatGPTOAuthError, publicProfile
};
