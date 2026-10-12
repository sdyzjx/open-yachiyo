const crypto = require('node:crypto');

const ISSUER = 'https://auth.openai.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

function decodePart(value, label) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid ID token ${label}`);
  }
}

function verifySignature(alg, key, data, signature) {
  if (alg === 'RS256') return crypto.verify('RSA-SHA256', data, key, signature);
  if (alg === 'PS256') {
    return crypto.verify('RSA-SHA256', data, {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32
    }, signature);
  }
  if (alg === 'ES256') return crypto.verify('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  throw new Error(`Unsupported ID token algorithm: ${alg || 'missing'}`);
}

async function verifyIdToken(idToken, {
  clientId,
  nonce,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  clockToleranceSec = 5
} = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token format');
  const header = decodePart(parts[0], 'header');
  const payload = decodePart(parts[1], 'payload');
  if (!header.kid || !header.alg) throw new Error('ID token header is incomplete');

  const response = await fetchImpl(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`OpenAI JWKS request failed (${response.status})`);
  const body = await response.json();
  const jwk = Array.isArray(body?.keys) ? body.keys.find((item) => item.kid === header.kid && (!item.alg || item.alg === header.alg)) : null;
  if (!jwk) throw new Error('ID token signing key was not found');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = verifySignature(header.alg, key, Buffer.from(`${parts[0]}.${parts[1]}`), Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new Error('ID token signature is invalid');

  const nowSec = Math.floor(now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) throw new Error('ID token issuer is invalid');
  if (!audience.includes(clientId)) throw new Error('ID token audience is invalid');
  if (audience.length > 1 && payload.azp === undefined) throw new Error('ID token authorized party is missing');
  if (payload.azp !== undefined && payload.azp !== clientId) throw new Error('ID token authorized party is invalid');
  if (!Number.isFinite(payload.exp) || payload.exp < nowSec - clockToleranceSec) throw new Error('ID token has expired');
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSec + clockToleranceSec) throw new Error('ID token is not active');
  if (!Number.isFinite(payload.iat) || payload.iat > nowSec + clockToleranceSec) throw new Error('ID token issued-at time is invalid');
  if (payload.nonce !== nonce) throw new Error('ID token nonce did not match');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('ID token subject is missing');
  return payload;
}

module.exports = { ISSUER, JWKS_URL, verifyIdToken };
