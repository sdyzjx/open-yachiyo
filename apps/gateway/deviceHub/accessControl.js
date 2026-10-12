const { tokenMatches } = require('./config');

const APPASSETS_ORIGIN = 'https://appassets.androidplatform.net';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocal(req) {
  return LOOPBACK_ADDRESSES.has(req?.socket?.remoteAddress);
}

function requestToken(req) {
  let queryToken = '';
  try {
    queryToken = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
  } catch {
    queryToken = '';
  }
  const authorization = String(req.headers?.authorization || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return bearer || queryToken;
}

function isAuthorized(req, token, { allowLocal = true } = {}) {
  return (allowLocal && isLocal(req)) || tokenMatches(requestToken(req), token);
}

function isAppassetsApiPath(pathname) {
  return pathname === '/api/device'
    || pathname.startsWith('/api/device/')
    || pathname === '/api/config/models'
    || pathname.startsWith('/api/config/models/');
}

function appassetsCors(req, res, next) {
  if (req.headers.origin === APPASSETS_ORIGIN && isAppassetsApiPath(req.path || '')) {
    res.set({
      'Access-Control-Allow-Origin': APPASSETS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    });
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
  }
  next();
}

function remoteApiAuth(token) {
  return (req, res, next) => {
    if (isAuthorized(req, token)) return next();
    res.set('Cache-Control', 'no-store').status(403).json({
      error: { code: -32006, message: 'Pairing token required' }
    });
  };
}

module.exports = {
  APPASSETS_ORIGIN,
  appassetsCors,
  isAuthorized,
  isLocal,
  remoteApiAuth,
  requestToken
};
