/*
 * Native bridge shim (contract C2.0). MUST be the first script of every host page, before any iframe exists.
 * Android injects only window.__YachiyoBridge { handshake(), invoke(token, method, argsJson) }; the token is kept
 * in this closure and never exposed on window or to plugins. Without the native bridge (desktop browser) this file
 * does nothing and mockNative.js takes over.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const METHODS = [
    'getConfig', 'setConfig', 'getDeviceInfo', 'hubState', 'hubConnect', 'hubDisconnect', 'hubPublish', 'hubSubscribe',
    'hubUnsubscribe', 'hubRpc', 'hubRpcRespond', 'hubRegister', 'hubUnregister', 'micStart', 'micStop', 'pickBackground',
    'pickPluginPackage', 'listPlugins', 'uninstallPlugin', 'setPluginEnabled', 'pluginStorageGet', 'pluginStorageSet',
    'openHomeSettings', 'listLaunchableApps', 'launchApp', 'setLockscreenEnabled', 'setOrientation', 'openSettings',
    'closeSettings', 'vibrate', 'log', 'consumeBack', 'dismissKeyguard'
  ];

  function install(root) {
    const native = root.__YachiyoBridge;
    if (!native || typeof native.handshake !== 'function') return false;
    const token = native.handshake();           // only the first call per page load returns a token
    if (!token) {
      if (root.console) root.console.error('[yachiyo] native handshake returned no token (page reused or script injected twice)');
      return false;
    }
    const shim = {};
    for (const name of METHODS) {
      shim[name] = (...args) => native.invoke(token, name, JSON.stringify(args));
    }
    Object.defineProperty(root, 'YachiyoNative', { value: Object.freeze(shim), writable: false, configurable: false });
    return true;
  }

  return { install, METHODS };
});
