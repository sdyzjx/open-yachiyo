const express = require('express');
const { isLocal } = require('../deviceHub/accessControl');

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function localAuthority(req) {
  const host = String(req.headers?.host || '');
  if (!host || /[\\/@]/.test(host)) return null;
  try {
    const parsed = new URL(`http://${host}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const port = Number(parsed.port || 80);
    if (!LOCAL_HOSTNAMES.has(hostname) || !Number.isInteger(port) || port !== req.socket?.localPort) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

function localOnly(req, res, next) {
  if (isLocal(req) && localAuthority(req)) return next();
  res.status(403).json({ ok: false, error: 'ChatGPT account settings are only available on this computer' });
}

function browserRequestGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const authority = localAuthority(req);
  const origin = req.headers?.origin;
  const fetchSite = req.headers?.['sec-fetch-site'];
  const hasFetchMetadata = Object.keys(req.headers || {}).some((name) => name.startsWith('sec-fetch-'));
  if (!authority) {
    res.status(403).json({ ok: false, error: 'Untrusted local request authority' });
    return;
  }
  if (origin !== undefined) {
    try {
      const parsed = new URL(String(origin));
      if (parsed.protocol !== 'http:' || parsed.host !== authority
        || (fetchSite !== undefined && !['same-origin', 'none'].includes(fetchSite))) throw new Error('untrusted');
      next();
      return;
    } catch {
      res.status(403).json({ ok: false, error: 'Cross-site browser requests are not allowed' });
      return;
    }
  }
  if (hasFetchMetadata) {
    res.status(403).json({ ok: false, error: 'Browser requests must include a trusted Origin' });
    return;
  }
  next();
}

function createChatGPTAuthRouter({ service }) {
  const router = express.Router();
  router.use('/api/chatgpt', localOnly);
  router.use('/api/chatgpt', browserRequestGuard);
  const ok = (res, data) => res.json({ ok: true, data });
  const fail = (res, status, error) => res.status(status).json({ ok: false, error: error.message || String(error) });

  router.get('/api/chatgpt/status', (req, res) => {
    try { ok(res, service.status()); } catch (error) { fail(res, 500, error); }
  });

  router.post('/api/chatgpt/auth/start', async (req, res) => {
    try { ok(res, await service.start({ profileId: req.body?.profile_id })); }
    catch (error) { fail(res, /already active/.test(error.message) ? 409 : 400, error); }
  });

  router.post('/api/chatgpt/auth/cancel', (req, res) => {
    try {
      if (typeof req.body?.attempt_id !== 'string') throw new Error('attempt_id is required');
      service.cancel(req.body.attempt_id);
      ok(res, service.status());
    } catch (error) { fail(res, 400, error); }
  });

  router.post('/api/chatgpt/signout', async (req, res) => {
    try { ok(res, await service.signOut({ profileId: req.body?.profile_id })); }
    catch (error) { fail(res, 400, error); }
  });

  router.post('/api/chatgpt/models/refresh', async (req, res) => {
    try { ok(res, { models: await service.refreshModels({ profileId: req.body?.profile_id }) }); }
    catch (error) { fail(res, 400, error); }
  });

  return router;
}

module.exports = { createChatGPTAuthRouter, localOnly, browserRequestGuard, localAuthority };
