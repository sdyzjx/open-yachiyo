/*
 * Development stand-in for window.YachiyoNative (contract C2). Active only when the real bridge is absent,
 * i.e. when the page is opened in a normal browser. Works fully offline; optionally connects a browser
 * WebSocket to the gateway Device Hub (ws://<host>:<port>/ws/device, contract C1).
 *
 * URL flags: ?hub=1 connect to the hub   ?mode=lockscreen   ?lowram=1   ?debug=1 (debug panel)
 */
(function (global) {
  'use strict';
  if (global.YachiyoNative) return;

  const params = new URLSearchParams(location.search);
  const CONFIG_KEY = 'yachiyo.mock.config';
  const DEVICE_KEY = 'yachiyo.mock.device_id';
  const PLUGIN_KEY = 'yachiyo.mock.plugins';

  const DEFAULT_CONFIG = {
    server: { host: location.hostname || 'localhost', port: 3000, token: '', auto_connect: false },
    appearance: { background: { type: 'color', color: '#1d2233', image_url: '' }, portrait_full_body: true, landscape_focus: 'upper_body', model_quality: 'auto' },
    task_canvas: { position: 'top', opacity: 0.85 },
    audio: { mic_mode: 'push_to_talk', volume: 1.0 },
    launcher: { enabled: params.get('launcher') === '1' },
    lockscreen: { enabled: false },
    orientation: 'auto',
    plugins: { app_order: [], widget_layout: [] },
    device: { alias: 'web' }
  };

  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ } }
  };

  function merge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    }
    return out;
  }

  let config = merge(DEFAULT_CONFIG, store.get(CONFIG_KEY, {}));
  if (params.get('hub') === '1') config.server.auto_connect = true;
  const mode = params.get('mode') === 'lockscreen' ? 'lockscreen' : 'normal';

  let deviceId = store.get(DEVICE_KEY, null);
  if (!deviceId) { deviceId = `web-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; store.set(DEVICE_KEY, deviceId); }

  function emit(type, data) {
    const bridge = global.__yachiyoNative;
    if (bridge) bridge.dispatch({ type, data });
  }

  /* ---------------- hub client ---------------- */
  const hub = {
    ws: null, state: 'disconnected', url: '', avatarHost: '', devices: [],
    subs: new Map(), methods: new Map(), retry: 0, timer: null, ping: null, wantConnected: false, seq: 0
  };

  const snapshot = () => ({ state: hub.state, url: hub.url, avatar_host: hub.avatarHost, devices: hub.devices });
  function setState(state) { hub.state = state; emit('hub.state', snapshot()); }

  function send(type, data, extra) {
    if (hub.ws && hub.ws.readyState === 1) hub.ws.send(JSON.stringify({ v: 1, type, ...(extra || {}), data, ts: Date.now() }));
  }

  function connect() {
    hub.wantConnected = true;
    if (hub.ws || !config.server.host) return;
    const { host, port, token } = config.server;
    hub.url = `ws://${host}:${port}/ws/device`;
    setState('connecting');
    let ws;
    try { ws = new WebSocket(`${hub.url}?token=${encodeURIComponent(token || '')}`); } catch { scheduleRetry(); return; }
    hub.ws = ws;
    ws.onopen = () => send('hello', {
      device_id: deviceId, device_type: 'web', name: config.device.alias || 'web', app_version: 'mock', mode,
      capabilities: ['live2d', 'audio.play', 'audio.capture', 'plugins'],
      screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1, orientation: innerWidth > innerHeight ? 'landscape' : 'portrait' }
    });
    ws.onmessage = (ev) => { try { onFrame(JSON.parse(ev.data)); } catch { /* ignore */ } };
    ws.onclose = (ev) => {
      clearInterval(hub.ping);
      hub.ws = null;
      if (ev.code === 1008) { hub.wantConnected = false; setState('unauthorized'); return; }
      setState('disconnected');
      if (hub.wantConnected) scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  function scheduleRetry() {
    clearTimeout(hub.timer);
    hub.retry = Math.min(hub.retry + 1, 6);
    hub.timer = setTimeout(() => { if (hub.wantConnected && !hub.ws) connect(); }, Math.min(30000, 1000 * 2 ** (hub.retry - 1)));
  }

  function disconnect() {
    hub.wantConnected = false;
    clearTimeout(hub.timer);
    if (hub.ws) { try { hub.ws.close(1000); } catch { /* ignore */ } }
    hub.ws = null;
    setState('disconnected');
  }

  function onFrame(msg) {
    switch (msg.type) {
      case 'welcome': {
        const d = msg.data || {};
        hub.retry = 0;
        hub.avatarHost = d.avatar_host || '';
        hub.devices = d.devices || [];
        setState('connected');
        const patterns = Array.from(hub.subs.keys());
        if (patterns.length) send('sub', { topics: patterns });
        if (hub.methods.size) send('rpc.register', { methods: Array.from(hub.methods.values()) });
        clearInterval(hub.ping);
        hub.ping = setInterval(() => send('ping', {}), d.heartbeat_ms || 15000);
        break;
      }
      case 'event': {
        const data = msg.data || {};
        if (msg.topic === 'avatar.host.changed' && data.host) { hub.avatarHost = data.host; emit('hub.state', snapshot()); }
        emit('hub.event', { topic: msg.topic, data, from: msg.from || 'gateway' });
        break;
      }
      case 'rpc.req':
        emit('hub.rpc.request', { id: msg.id, method: msg.data && msg.data.method, params: (msg.data && msg.data.params) || {}, from: msg.from || 'gateway' });
        break;
      case 'rpc.res':
        emit('hub.rpc.result', { call_id: msg.id, ...(msg.data && msg.data.error ? { error: msg.data.error } : { result: msg.data && msg.data.result }) });
        break;
      case 'error':
        console.warn('[mockNative] hub error', msg.data);
        break;
      default:
    }
  }

  /* ---------------- microphone ---------------- */
  const mic = { stream: null, ctx: null, node: null, id: '', seq: 0, buf: [], fake: null };

  async function micStart(options) {
    if (mic.id) return;
    mic.id = `mic-${Date.now().toString(36)}`;
    mic.seq = 0;
    mic.buf = [];
    emit('mic.state', { state: 'recording', stream_id: mic.id });
    send('pub', { stream_id: mic.id, format: 'pcm_s16le', sample_rate: 16000, channels: 1, mode: (options && options.mode) || 'push_to_talk', lang: 'auto' }, { topic: 'audio.input.start' });
    try {
      mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      mic.ctx = new (global.AudioContext || global.webkitAudioContext)();
      const src = mic.ctx.createMediaStreamSource(mic.stream);
      const node = mic.ctx.createScriptProcessor(2048, 1, 1);
      const ratio = mic.ctx.sampleRate / 16000;
      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
        emit('mic.level', { rms: Math.min(1, Math.sqrt(sum / input.length) * 4) });
        for (let i = 0; i < input.length; i += ratio) mic.buf.push(Math.max(-1, Math.min(1, input[Math.floor(i)])));
        while (mic.buf.length >= 1600) {
          const chunk = mic.buf.splice(0, 1600);
          const bytes = new Uint8Array(3200);
          const dv = new DataView(bytes.buffer);
          chunk.forEach((s, i) => dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true));
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          send('pub', { stream_id: mic.id, seq: mic.seq++, data_b64: btoa(bin) }, { topic: 'audio.input.chunk' });
        }
      };
      src.connect(node);
      node.connect(mic.ctx.destination);
      mic.node = node;
    } catch {
      // No mic permission / insecure origin: simulate a level so the UI can still be exercised.
      mic.fake = setInterval(() => emit('mic.level', { rms: 0.2 + Math.random() * 0.5 }), 50);
    }
  }

  function micStop(reason) {
    if (!mic.id) return;
    clearInterval(mic.fake);
    if (mic.node) { try { mic.node.disconnect(); } catch { /* ignore */ } }
    if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
    if (mic.ctx) { try { mic.ctx.close(); } catch { /* ignore */ } }
    send('pub', { stream_id: mic.id, reason: reason || 'released' }, { topic: 'audio.input.end' });
    const id = mic.id;
    Object.assign(mic, { stream: null, ctx: null, node: null, id: '', fake: null });
    emit('mic.state', { state: reason === 'cancel' ? 'idle' : 'uploading', stream_id: id });
    setTimeout(() => emit('mic.state', { state: 'idle' }), 600);
    emit('mic.level', { rms: 0 });
  }

  /* ---------------- plugins ---------------- */
  function loadPlugins() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/__dev/plugins', false);
      xhr.send();
      if (xhr.status !== 200) return [];
      const state = store.get(PLUGIN_KEY, {});
      return JSON.parse(xhr.responseText).map((p) => ({ ...p, enabled: state[p.id] !== false }));
    } catch { return []; }
  }

  function fakeApps() {
    const names = ['Camera', 'Messages', 'Maps', 'Music', 'Notes', 'Clock', 'Files', 'Photos', 'Browser', 'Mail', 'Calendar', 'Settings', 'Phone', 'Weather', 'Wallet', 'Recorder'];
    return names.map((label, i) => {
      const hue = (i * 47) % 360;
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='24' fill='hsl(${hue},55%,52%)'/><text x='48' y='62' font-size='40' text-anchor='middle' fill='white' font-family='sans-serif'>${label[0]}</text></svg>`;
      return { package: `mock.${label.toLowerCase()}`, label, icon_url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
    });
  }

  /* ---------------- bridge surface ---------------- */
  const ok = 'ok';
  const jp = (s) => { try { return JSON.parse(s); } catch { return null; } };

  global.YachiyoNative = {
    getConfig: () => JSON.stringify(config),
    setConfig(patchJson) {
      const patch = jp(patchJson);
      if (!patch) return JSON.stringify({ error: 'invalid json' });
      config = { ...config, ...patch }; // C2.1: shallow merge, like the real bridge
      store.set(CONFIG_KEY, config);
      setTimeout(() => emit('config.changed', config), 0);
      return ok;
    },
    getDeviceInfo: () => JSON.stringify({
      device_id: deviceId, model: 'Browser', sdk: 0, app_version: 'mock', mock: true,
      low_ram: params.get('lowram') === '1', total_mem_mb: Math.round((navigator.deviceMemory || 4) * 1024),
      is_default_launcher: false, mode
    }),
    hubState: () => JSON.stringify(snapshot()),
    hubConnect: connect,
    hubDisconnect: disconnect,
    hubPublish(topic, dataJson) {
      const data = jp(dataJson) || {};
      if (hub.state === 'connected') send('pub', data, { topic });
      else setTimeout(() => { if (hub.subs.size) emit('hub.event', { topic, data, from: deviceId }); }, 0); // offline loopback
    },
    hubSubscribe(json) { const l = jp(json) || []; l.forEach((p) => hub.subs.set(p, true)); if (hub.state === 'connected') send('sub', { topics: l }); },
    hubUnsubscribe(json) { const l = jp(json) || []; l.forEach((p) => hub.subs.delete(p)); if (hub.state === 'connected') send('unsub', { topics: l }); },
    hubRpc(callId, method, paramsJson, target) {
      if (hub.state !== 'connected') {
        setTimeout(() => emit('hub.rpc.result', { call_id: callId, error: { code: -32010, message: 'hub not connected' } }), 0);
        return;
      }
      hub.rpcIds = hub.rpcIds || new Map();
      send('rpc.req', { method, params: jp(paramsJson) || {}, ...(target ? { target } : {}) }, { id: callId });
    },
    hubRpcRespond(reqId, resultJson, errorJson) {
      send('rpc.res', errorJson ? { error: jp(errorJson) } : { result: jp(resultJson) }, { id: reqId });
    },
    hubRegister(json) {
      const l = jp(json) || [];
      l.forEach((m) => hub.methods.set(m.name, m));
      if (hub.state === 'connected') send('rpc.register', { methods: l });
    },
    hubUnregister(json) {
      const l = jp(json) || [];
      l.forEach((n) => hub.methods.delete(n));
      if (hub.state === 'connected') send('rpc.unregister', { methods: l });
    },
    micStart: (o) => { micStart(jp(o) || {}); },
    micStop: (r) => { micStop(r); },
    pickBackground() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => emit('picker.result', { kind: 'background', uri: f.name, url: String(reader.result) });
        reader.readAsDataURL(f);
      };
      input.click();
    },
    pickPluginPackage() { emit('picker.result', { kind: 'plugin', error: 'plugin import needs the Android app (mock lists sample plugins automatically)' }); },
    listPlugins: () => JSON.stringify(loadPlugins()),
    uninstallPlugin() { /* no-op in browser */ },
    setPluginEnabled(id, enabled) {
      const state = store.get(PLUGIN_KEY, {});
      state[id] = enabled === true || enabled === "true";
      store.set(PLUGIN_KEY, state);
      setTimeout(() => emit('plugins.changed', loadPlugins()), 0);
    },
    pluginStorageGet(pluginId, key) { return store.get(`yachiyo.mock.plugin.${pluginId}.${key}`, null) === null ? '' : JSON.stringify(store.get(`yachiyo.mock.plugin.${pluginId}.${key}`, null)); },
    pluginStorageSet(pluginId, key, valueJson) { store.set(`yachiyo.mock.plugin.${pluginId}.${key}`, jp(valueJson)); },
    openHomeSettings() { alert('Opens the system default-home settings on Android.'); },
    listLaunchableApps: () => JSON.stringify(fakeApps()),
    launchApp(pkg) { console.log('[mockNative] launchApp', pkg); },
    setLockscreenEnabled(v) { config = merge(config, { lockscreen: { enabled: v === true || v === 'true' } }); store.set(CONFIG_KEY, config); },
    setOrientation(m) { config = merge(config, { orientation: m }); store.set(CONFIG_KEY, config); },
    openSettings() { location.href = 'settings.html'; },
    closeSettings() { location.href = 'index.html'; },
    vibrate(ms) { if (navigator.vibrate) navigator.vibrate(Number(ms) || 20); },
    consumeBack() { /* not needed in browser */ },
    log(level, msg) { /* console logging is done by the bridge wrapper */ }
  };

  global.YachiyoMockNative = { hub, emit, getConfig: () => config, deviceId, connect, disconnect };

  // Mirror native behaviour: announce state shortly after load, auto-connect when configured.
  setTimeout(() => {
    emit('hub.state', snapshot());
    emit('lifecycle', { state: 'resume', mode });
    if (config.server.auto_connect) connect();
  }, 0);
})(window);
