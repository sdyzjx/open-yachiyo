const os = require('node:os');
const { tokenMatches } = require('./config');

function isLocal(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function attachHttpRoutes({ app, server, hub }) {
  app.use('/api/device', (req, res, next) => {
    if (isLocal(req) || tokenMatches(req.query.token || String(req.headers.authorization || '').replace(/^Bearer /, ''), hub.token)) return next();
    res.status(403).json({ error: { code: -32006, message: 'Pairing token required' } });
  });
  app.get('/api/device/pairing', (req, res) => {
    if (!isLocal(req)) return res.sendStatus(403);
    const port = server.address()?.port || 3000;
    const addresses = Object.values(os.networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address);
    res.set('Cache-Control', 'no-store').json({ token: hub.token, urls: [...new Set(['127.0.0.1', ...addresses])].map((ip) => `ws://${ip}:${port}/ws/device`) });
  });
  app.get('/api/device/media/:id', (req, res) => {
    const entry = hub.voiceRelay?.get(req.params.id);
    if (!entry) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').type(entry.mime).sendFile(entry.file);
  });
  app.post('/api/device/avatar/transfer', async (req, res) => {
    try { res.json(await hub.transferAvatar(req.body)); }
    catch (err) { res.status(err.code === -32602 ? 400 : 409).json({ error: { code: err.code || -32600, message: err.message } }); }
  });
  app.get('/api/device/devices', (req, res) => res.json({ devices: hub.listDevices(), avatar_host: hub.getAvatarHost() }));
}

module.exports = { attachHttpRoutes, isLocal };
