const express = require('express');
const { isLocal } = require('../deviceHub/accessControl');

function localOnly(req, res, next) {
  if (isLocal(req)) return next();
  res.status(403).json({ ok: false, error: 'ChatGPT account settings are only available on this computer' });
}

function createChatGPTAuthRouter({ service }) {
  const router = express.Router();
  router.use('/api/chatgpt', localOnly);
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

module.exports = { createChatGPTAuthRouter, localOnly };
