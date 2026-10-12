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

// Only the device channel is exposed to the Android WebView origin. /api/config/** is a
// local administration surface and is intentionally NOT listed (no CORS headers at all).
function isAppassetsApiPath(pathname) {
  return pathname === '/api/device' || pathname.startsWith('/api/device/');
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

// /api/config/** is loopback-only. Decided purely by the TCP peer address: X-Forwarded-For is
// ignored and a valid pairing token does not unlock it.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostnameOf(value) {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// DNS rebinding guard: a hostile page whose domain resolves to 127.0.0.1 still sends its own
// Host/Origin, so the loopback peer check alone is not enough for a local admin surface.
function isLoopbackHostAndOrigin(req) {
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(req.headers?.host || ''))) return false;
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function configLoopbackOnly(req, res, next) {
  if (isLocal(req) && isLoopbackHostAndOrigin(req)) return next();
  res.set('Cache-Control', 'no-store').status(403).json({
    ok: false,
    error: 'Configuration APIs are only available from the local machine'
  });
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
  configLoopbackOnly,
  isAuthorized,
  isLocal,
  isLoopbackHostAndOrigin,
  remoteApiAuth,
  requestToken
};
