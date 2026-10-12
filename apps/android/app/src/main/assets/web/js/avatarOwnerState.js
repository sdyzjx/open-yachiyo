(function expose(root) {
  'use strict';

  function createOwnerTracker({ deviceId = '', initialHub = {} } = {}) {
    let host = String(initialHub?.avatar_host || '');
    function update(hub = {}) {
      const incoming = String(hub?.avatar_host || '');
      const previousHost = host;
      if (incoming) host = incoming;
      return {
        host,
        previousHost,
        ownerChanged: Boolean(host && host !== previousHost),
        isHost: Boolean(host && host === deviceId)
      };
    }
    function snapshot() {
      return { host, isHost: Boolean(host && host === deviceId) };
    }
    return { snapshot, update };
  }

  const api = { createOwnerTracker };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YachiyoAvatarOwnerState = api;
})(typeof window === 'undefined' ? globalThis : window);
