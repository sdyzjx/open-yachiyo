const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatGPTCredentialStore } = require('../../../apps/runtime/auth/chatgpt/credentialStore');
const { verifyIdToken, ISSUER } = require('../../../apps/runtime/auth/chatgpt/oidc');
const {
  AUTHORIZE_URL, TOKEN_URL, DISCOVERY_URL, RESOURCE, DIRECT_SCOPE, ChatGPTAuthService
} = require('../../../apps/runtime/auth/chatgpt/service');
const { ProviderConfigStore } = require('../../../apps/runtime/config/providerConfigStore');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-chatgpt-'));
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('TC-LLM-029 credential store persists an isolated host and owner-only profiles', () => {
  const root = tempDir();
  const store = new ChatGPTCredentialStore({ rootDir: path.join(root, 'chatgpt-auth') });
  const firstHost = store.getHostId();
  assert.match(firstHost, /^urn:uuid:/);
  assert.equal(store.getHostId(), firstHost);
  const saved = store.saveProfile({
    issuer: ISSUER, subject: 'subject-1', client_id: 'oaiapp_test', email: 'person@example.com',
    access_token: 'access-secret', refresh_token: 'refresh-secret', id_token: 'id-secret',
    connected: true, scopes: [DIRECT_SCOPE], expires_at: new Date(Date.now() + 60000).toISOString()
  });
  assert.equal(store.getActiveProfile().id, saved.id);
  assert.equal(store.getProfile(saved.id).access_token, 'access-secret');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.rootDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(store.profilePath(saved.id)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(store.hostPath).mode & 0o777, 0o600);
  }
});

test('TC-LLM-030 ID token verification checks signature, issuer, audience, expiry and nonce', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const now = 1800000000000;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const payloadValue = {
    iss: ISSUER, aud: 'oaiapp_test', sub: 'subject-1', nonce: 'nonce-1',
    iat: Math.floor(now / 1000) - 1, exp: Math.floor(now / 1000) + 60, email: 'person@example.com'
  };
  const sign = (value) => {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
  const token = sign(payloadValue);
  const verified = await verifyIdToken(token, {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  });
  assert.equal(verified.sub, 'subject-1');
  await assert.rejects(verifyIdToken(token, {
    clientId: 'wrong', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  }), /audience/);
  await assert.rejects(verifyIdToken(token, {
    clientId: 'oaiapp_test', nonce: 'wrong', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  }), /nonce/);
  const singleAudienceWithAuthorizedParty = { ...payloadValue, azp: 'oaiapp_test' };
  assert.equal((await verifyIdToken(sign(singleAudienceWithAuthorizedParty), {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  })).sub, 'subject-1');
  await assert.rejects(verifyIdToken(sign({ ...singleAudienceWithAuthorizedParty, azp: 'another-client' }), {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  }), /authorized party/);
  const multipleAudiences = { ...payloadValue, aud: ['oaiapp_test', 'another-client'], azp: 'oaiapp_test' };
  assert.equal((await verifyIdToken(sign(multipleAudiences), {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  })).sub, 'subject-1');
  await assert.rejects(verifyIdToken(sign({ ...multipleAudiences, azp: undefined }), {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  }), /authorized party/);
  await assert.rejects(verifyIdToken(sign({ ...multipleAudiences, azp: 'another-client' }), {
    clientId: 'oaiapp_test', nonce: 'nonce-1', now: () => now,
    fetchImpl: async () => jsonResponse({ keys: [jwk] })
  }), /authorized party/);
});

test('TC-LLM-031 returning profile authorization URL never includes stored tokens', async (t) => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const profile = store.saveProfile({
    issuer: ISSUER, subject: 'subject-1', client_id: 'oaiapp_existing', email: 'person@example.com',
    access_token: 'stored-access-secret', refresh_token: 'stored-refresh-secret', id_token: 'stored-id-secret',
    connected: true, scopes: [DIRECT_SCOPE], expires_at: new Date(Date.now() + 3600000).toISOString()
  });
  const service = new ChatGPTAuthService({ store });
  t.after(() => service.close());
  const started = await service.start({ profileId: profile.id });
  const serialized = JSON.stringify(started);
  assert.doesNotMatch(serialized, /stored-(?:access|refresh|id)-secret/);
  const url = new URL(started.authorization_url);
  assert.equal(url.searchParams.has('id_token_hint'), false);
  assert.equal(url.searchParams.get('login_hint'), 'person@example.com');
  service.cancel(started.attempt_id);
});

test('TC-LLM-031 OAuth callback validates dynamic registration and exposes no credentials', async (t) => {
  const root = tempDir();
  const store = new ChatGPTCredentialStore({ rootDir: path.join(root, 'auth') });
  const configPath = path.join(root, 'providers.yaml');
  fs.writeFileSync(configPath, [
    'active_model: local/demo',
    'providers:',
    '  local:',
    '    type: openai_compatible',
    '    base_url: http://127.0.0.1:1/v1',
    '    api_key: local-key',
    '    model: demo'
  ].join('\n'));
  const providerStore = new ProviderConfigStore({ configPath });
  const requests = [];
  const service = new ChatGPTAuthService({
    store, providerStore,
    verifyIdentity: async (token, options) => {
      assert.equal(token, 'signed-id-token');
      assert.equal(options.clientId, 'oaiapp_yachiyo');
      return { iss: ISSUER, sub: 'subject-1', email: 'person@example.com', name: 'Person' };
    },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (url === TOKEN_URL) return jsonResponse({
        access_token: 'access-secret', refresh_token: 'refresh-secret', id_token: 'signed-id-token',
        token_type: 'Bearer', expires_in: 3600,
        scope: `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
      });
      if (url === `${RESOURCE}/models`) return jsonResponse({ models: [
        { slug: 'gpt-visible', display_name: 'GPT Visible', visibility: 'list' },
        { slug: 'gpt-hidden', display_name: 'GPT Hidden', visibility: 'hide' }
      ] });
      throw new Error(`unexpected URL ${url}`);
    }
  });
  t.after(() => service.close());
  const started = await service.start();
  const authUrl = new URL(started.authorization_url);
  assert.equal(authUrl.origin, new URL(AUTHORIZE_URL).origin);
  assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authUrl.searchParams.get('resource'), RESOURCE);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('ext_agent_host_id'), store.getHostId());
  const callback = new URL(authUrl.searchParams.get('redirect_uri'));
  callback.searchParams.set('code', 'authorization-code');
  callback.searchParams.set('state', authUrl.searchParams.get('state'));
  callback.searchParams.set('client_id', 'oaiapp_yachiyo');
  assert.equal((await fetch(callback)).status, 200);
  await waitFor(() => service.status().pending === null);

  const status = service.status();
  assert.equal(status.connected, true);
  assert.equal(status.plan_usage_enabled, true);
  assert.equal(status.active_profile.email, 'person@example.com');
  assert.equal(status.profiles.length, 1);
  assert.equal(JSON.stringify(status).includes('access-secret'), false);
  assert.equal(JSON.stringify(status).includes('refresh-secret'), false);
  const config = providerStore.loadNormalized();
  assert.deepEqual(config.providers.chatgpt.models.map((model) => model.id), ['gpt-visible']);
  assert.equal(config.providers.chatgpt.api_key, undefined);
  assert.equal(requests.filter((request) => request.url === TOKEN_URL).length, 1);
});

test('TC-LLM-032 state mismatch stays isolated and matching cancel closes the attempt', async (t) => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const service = new ChatGPTAuthService({ store, attemptTtlMs: 5000 });
  t.after(() => service.close());
  const started = await service.start();
  const authUrl = new URL(started.authorization_url);
  const callback = new URL(authUrl.searchParams.get('redirect_uri'));
  callback.searchParams.set('code', 'code');
  callback.searchParams.set('state', 'wrong');
  callback.searchParams.set('client_id', 'oaiapp_wrong');
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(service.status().pending.attempt_id, started.attempt_id);
  assert.throws(() => service.cancel('other-attempt'), /not found/);
  service.cancel(started.attempt_id);
  assert.equal(service.status().pending, null);
  assert.equal(store.listProfiles().length, 0);
  await assert.rejects(fetch(callback));
});

test('TC-LLM-032 expired attempts abort work and close their loopback listener', async (t) => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const service = new ChatGPTAuthService({ store, attemptTtlMs: 20 });
  t.after(() => service.close());
  const started = await service.start();
  const callback = new URL(new URL(started.authorization_url).searchParams.get('redirect_uri'));
  await waitFor(() => service.status().pending === null);
  assert.match(service.status().error, /timed out/);
  await assert.rejects(fetch(callback));
});

test('TC-LLM-032 concurrent starts reserve synchronously and listen failure releases the reservation', async (t) => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const service = new ChatGPTAuthService({ store });
  t.after(() => service.close());
  const settled = await Promise.allSettled([service.start(), service.start()]);
  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((result) => result.status === 'rejected').length, 1);
  assert.match(settled.find((result) => result.status === 'rejected').reason.message, /already active/);
  service.cancel(settled.find((result) => result.status === 'fulfilled').value.attempt_id);
  assert.equal(service.status().pending, null);

  const failed = new ChatGPTAuthService({
    store,
    serverFactory: () => {
      const server = new (require('node:events').EventEmitter)();
      server.listening = false;
      server.listen = () => queueMicrotask(() => server.emit('error', new Error('bind failed')));
      server.close = () => {};
      return server;
    }
  });
  await assert.rejects(failed.start(), /bind failed/);
  assert.equal(failed.status().pending, null);
});

test('TC-LLM-033 access refresh is serialized and rotates the stored token set', async () => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const profile = store.saveProfile({
    issuer: ISSUER, subject: 'subject-1', client_id: 'oaiapp_test', email: 'person@example.com',
    access_token: 'expired-access', refresh_token: 'old-refresh', id_token: 'id-token', connected: true,
    scopes: [DIRECT_SCOPE], expires_at: new Date(Date.now() - 1000).toISOString()
  });
  let calls = 0;
  const service = new ChatGPTAuthService({ store, fetchImpl: async (url) => {
    assert.equal(url, TOKEN_URL);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return jsonResponse({
      access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'unverified-new-id',
      expires_in: 3600, scope: DIRECT_SCOPE
    });
  } });
  const values = await Promise.all([service.getAccessToken(), service.getAccessToken()]);
  assert.deepEqual(values, ['new-access', 'new-access']);
  assert.equal(calls, 1);
  assert.equal(store.getProfile(profile.id).refresh_token, 'new-refresh');
  assert.equal(store.getProfile(profile.id).id_token, 'id-token');
});

test('TC-LLM-034 signout discovers and validates the revocation endpoint before clearing tokens', async () => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const profile = store.saveProfile({
    issuer: ISSUER, subject: 'subject-1', client_id: 'oaiapp_test',
    access_token: 'access', refresh_token: 'refresh', id_token: 'id', connected: true,
    scopes: [DIRECT_SCOPE], expires_at: new Date(Date.now() + 3600000).toISOString()
  });
  const service = new ChatGPTAuthService({ store, fetchImpl: async (url) => {
    if (url === DISCOVERY_URL) return jsonResponse({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' });
    if (url === 'https://auth.openai.com/oauth/revoke') return new Response('', { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  } });
  const result = await service.signOut({ profileId: profile.id });
  assert.equal(result.revoked, true);
  assert.equal(store.getProfile(profile.id).access_token, null);
  assert.equal(service.status().connected, false);
});

test('TC-LLM-033 token failures redact upstream bodies and model 401 refreshes only once', async () => {
  const store = new ChatGPTCredentialStore({ rootDir: path.join(tempDir(), 'auth') });
  const profile = store.saveProfile({
    issuer: ISSUER, subject: 'subject-1', client_id: 'oaiapp_test',
    access_token: 'old-access', refresh_token: 'old-refresh', id_token: 'id', connected: true,
    scopes: [DIRECT_SCOPE], expires_at: new Date(Date.now() + 3600000).toISOString()
  });
  let catalogCalls = 0;
  let tokenCalls = 0;
  const service = new ChatGPTAuthService({ store, fetchImpl: async (url) => {
    if (url === TOKEN_URL) {
      tokenCalls += 1;
      return jsonResponse({
        access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: DIRECT_SCOPE
      });
    }
    if (url === `${RESOURCE}/models`) {
      catalogCalls += 1;
      return jsonResponse({ error: { message: 'Authorization: Bearer upstream-secret' } }, catalogCalls === 1 ? 401 : 429);
    }
    throw new Error(`unexpected URL ${url}`);
  } });
  await assert.rejects(service.refreshModels({ profileId: profile.id }), (error) => {
    assert.match(error.message, /\(429\)/);
    assert.doesNotMatch(error.message, /upstream-secret|Authorization|old-access|new-access/);
    return true;
  });
  assert.equal(catalogCalls, 2);
  assert.equal(tokenCalls, 1);

  const failing = new ChatGPTAuthService({ store, fetchImpl: async () => jsonResponse({
    error: { code: 'invalid_grant', message: 'Authorization: Bearer upstream-secret' }
  }, 400) });
  await assert.rejects(failing.requestToken({ grant_type: 'refresh_token' }), (error) => {
    assert.match(error.message, /invalid_grant/);
    assert.doesNotMatch(error.message, /upstream-secret|Authorization/);
    return true;
  });
});
