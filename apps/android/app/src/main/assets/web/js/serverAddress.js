/* URL-safe formatting for manually entered and DNS-SD server hosts. UMD for Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YachiyoServerAddress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeHost(host) {
    const h = String(host || '').trim();
    return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  }

  function hostForUrl(host) {
    const h = normalizeHost(host);
    if (!h.includes(':')) return h;
    return `[${h.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')}]`;
  }

  function baseUrl(scheme, host, port) {
    return `${scheme}://${hostForUrl(host)}:${Number(port) || 3000}`;
  }

  function sameEndpoint(a, b) {
    return normalizeHost(a && a.host).toLowerCase() === normalizeHost(b && b.host).toLowerCase()
      && Number((a && a.port) || 3000) === Number((b && b.port) || 3000);
  }

  function endpointPatch(current, candidate) {
    const next = { host: normalizeHost(candidate && candidate.host), port: Number((candidate && candidate.port) || 3000) };
    return { ...next, token: sameEndpoint(current, next) ? String((current && current.token) || '') : '' };
  }

  return { normalizeHost, hostForUrl, baseUrl, sameEndpoint, endpointPatch };
});
