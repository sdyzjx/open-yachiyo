/* Normalize the model API response consumed by the Android settings page. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YachiyoSettingsModels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeResponse(payload) {
    const data = payload && payload.ok === true && payload.data && typeof payload.data === 'object'
      ? payload.data : payload;
    if (!data || typeof data !== 'object' || !Array.isArray(data.models)) return null;
    return {
      ...data,
      active: typeof data.active === 'string' ? data.active : '',
      enabled: Array.isArray(data.enabled) ? data.enabled : [],
      models: data.models.filter((model) => model && typeof model.ref === 'string')
    };
  }

  return { normalizeResponse };
});
