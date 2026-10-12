/* Settings page (task 10). All persistent state goes through YachiyoNative.setConfig (deep-merged natively). */
(function () {
  'use strict';

  const B = window.YachiyoBridge;
  const Address = window.YachiyoServerAddress;
  const SettingsModels = window.YachiyoSettingsModels;
  const root = document.getElementById('root');
  let cfg = B.getConfig();
  const info = B.deviceInfo();
  let hub = B.hubState();
  let plugins = [];
  let models = null;     // result of GET /api/config/models, or null when unavailable
  let modelsError = '';
  let testing = false;
  let discovery = { state: 'stopped', reason: '', error: '' };
  let discoveredServices = [];
  const OFFICIAL_NIGHT_BACKGROUND = 'https://www.cho-kaguyahime.com/assets/img/character/character_bg.jpg';

  const set = (patch) => { B.setConfig(patch); };

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid)); }
    return n;
  }

  const row = (label, control, hint) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', { class: 'label' }, label), hint ? h('span', { class: 'hint' }, hint) : null), control);
  const card = (title, ...rows) => h('section', null, h('h2', null, title), h('div', { class: 'card' }, rows));

  function toggle(value, onChange) {
    const s = h('button', { class: 'switch', role: 'switch', type: 'button', 'aria-checked': String(!!value) });
    s.onclick = () => { const next = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', String(next)); onChange(next); };
    return s;
  }

  function text(value, onCommit, props = {}) {
    const i = h('input', { type: 'text', value: value ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...props });
    i.addEventListener('change', () => onCommit(i.value.trim()));
    return i;
  }

  function select(value, options, onChange) {
    const s = h('select', null, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
    s.onchange = () => onChange(s.value);
    return s;
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 2400);
  }

  const HUB_LABEL = { connected: '已连接', connecting: '连接中…', disconnected: '未连接', unauthorized: 'token 无效' };

  function connectionSection() {
    const s = cfg.server || {};
    const status = h('div', { class: 'status' }, h('span', { class: `dot ${hub.state}` }), HUB_LABEL[hub.state] || hub.state, hub.state === 'connected' && hub.avatar_host ? ` · 八千代在 ${hub.avatar_host === 'desktop' ? '电脑' : '本机/其他设备'}` : '');
    const test = h('button', { class: 'btn primary', type: 'button', onclick: runTest }, testing ? '测试中…' : '测试连接');
    const scanning = discovery.state === 'scanning';
    const scan = h('button', { class: `btn${scanning ? '' : ' primary'}`, type: 'button', onclick: () => B.call(scanning ? 'stopServerDiscovery' : 'startServerDiscovery') }, scanning ? '停止扫描' : '查找局域网服务');
    const discoveryStatus = discovery.state === 'error'
      ? `发现失败：${discovery.error || reasonLabel(discovery.reason)}`
      : scanning ? '正在查找同一局域网中的 Yachiyo…'
        : discoveredServices.length ? `找到 ${discoveredServices.length} 个服务`
          : discovery.reason === 'timeout' ? '未发现服务，可继续手动输入地址' : '通过局域网发现服务端，不会读取或传输配对令牌';
    const candidates = discoveredServices.length
      ? h('div', { class: 'discovery-list' }, discoveredServices.map((service) => h('button', {
        class: 'server-candidate', type: 'button', onclick: () => chooseService(service)
      }, h('span', { class: 'candidate-name' }, service.name), h('span', { class: 'candidate-address' }, `${service.host}:${service.port}`))))
      : null;
    return card('服务器',
      row('地址', text(s.host, (v) => setServerEndpoint({ host: v })), '运行网关的电脑 IP'),
      row('端口', text(s.port, (v) => setServerEndpoint({ port: Number(v) || 3000 }), { inputmode: 'numeric' })),
      row('配对 token', text(s.token, (v) => set({ server: { token: v } }), { type: 'password' }), '网关控制台或 /api/device/pairing'),
      row('启动时自动连接', toggle(s.auto_connect, (v) => set({ server: { auto_connect: v } }))),
      row('局域网发现', scan, discoveryStatus),
      candidates,
      row(status, test));
  }

  function reasonLabel(reason) {
    return ({ permission_denied: '系统拒绝了局域网发现权限', unavailable: '当前网络不支持服务发现', lifecycle: '页面已离开', manual: '扫描已停止', timeout: '扫描超时' })[reason] || '未知错误';
  }

  function chooseService(service) {
    const current = cfg.server || {};
    const next = Address.endpointPatch(current, service);
    const changed = !Address.sameEndpoint(current, next);
    set({ server: next });
    B.call('stopServerDiscovery');
    toast(changed ? `已选择 ${service.name}，请填写该服务端的配对 token` : `已选择 ${service.name}`);
  }

  function setServerEndpoint(patch) {
    const current = cfg.server || {};
    const next = Address.endpointPatch(current, { host: patch.host === undefined ? current.host : patch.host, port: patch.port === undefined ? current.port : patch.port });
    const changed = !Address.sameEndpoint(current, next);
    set({ server: next });
    if (changed && current.token) toast('服务端已更换，请重新填写配对 token');
  }

  function runTest() {
    if (testing) return;
    testing = true;
    B.call('hubDisconnect');
    B.call('hubConnect');
    render();
    const done = () => { testing = false; render(); };
    const off = B.on('hub.state', (st) => { if (st && (st.state === 'connected' || st.state === 'unauthorized')) { off(); clearTimeout(timer); toast(st.state === 'connected' ? '连接成功' : 'token 无效'); done(); } });
    const timer = setTimeout(() => { off(); toast('连接超时，请检查地址与网络'); done(); }, 6000);
  }

  function appearanceSection() {
    const a = cfg.appearance || {};
    const bg = a.background || {};
    const color = h('input', { type: 'color', value: bg.color || '#1d2233' });
    color.onchange = () => set({ appearance: { background: { type: 'color', color: color.value } } });
    const swatch = h('div', { class: 'swatch', style: bg.type === 'image' && bg.image_url ? `background-image:url("${bg.image_url}")` : `background:${bg.color || '#1d2233'}` });
    const useOfficialNight = () => set({ appearance: { background: { type: 'image', image_url: OFFICIAL_NIGHT_BACKGROUND, color: '#090b20' } } });
    return card('外观',
      row('背景预览', swatch),
      row('夜景主题', h('button', { class: 'btn primary', type: 'button', onclick: useOfficialNight }, '使用官网夜景'),
        h('span', { class: 'source-note' }, '月读宫殿夜景 · ', h('a', { href: OFFICIAL_NIGHT_BACKGROUND, target: '_blank', rel: 'noreferrer' }, '图片来源'))),
      row('背景颜色', color),
      row('背景图片', h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn', type: 'button', onclick: () => B.call('pickBackground') }, '选择图片'),
        bg.type === 'image' ? h('button', { class: 'btn', type: 'button', onclick: () => set({ appearance: { background: { type: 'color' } } }) }, '移除') : null)),
      row('模型画质', select(a.model_quality || 'auto', [['auto', '自动'], ['4096', '高 (4096)'], ['2048', '省内存 (2048)']], (v) => set({ appearance: { model_quality: v } })), '低内存设备自动使用 2048'),
      row('竖屏显示全身', toggle(a.portrait_full_body !== false, (v) => set({ appearance: { portrait_full_body: v } }))),
      row('横屏取景', select(a.landscape_focus || 'upper_body', [['upper_body', '聚焦上半身'], ['full_body', '全身']], (v) => set({ appearance: { landscape_focus: v } }))),
      row('屏幕方向', select(cfg.orientation || 'auto', [['auto', '自动'], ['portrait', '竖屏'], ['landscape', '横屏']], (v) => { B.call('setOrientation', v); set({ orientation: v }); })));
  }

  function canvasSection() {
    const t = cfg.task_canvas || {};
    const range = h('input', { type: 'range', min: '0.2', max: '1', step: '0.05', value: String(t.opacity ?? 0.85) });
    range.onchange = () => set({ task_canvas: { opacity: Number(range.value) } });
    return card('任务画布',
      row('位置', select(t.position || 'top', [['top', '顶部'], ['bottom', '底部'], ['left', '左侧'], ['right', '右侧'], ['hidden', '隐藏']], (v) => set({ task_canvas: { position: v } }))),
      row('不透明度', range));
  }

  function audioSection() {
    const au = cfg.audio || {};
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(au.volume ?? 1) });
    vol.onchange = () => set({ audio: { volume: Number(vol.value) } });
    return card('语音',
      row('麦克风模式', select(au.mic_mode || 'push_to_talk', [['push_to_talk', '按住说话'], ['continuous', '连续监听']], (v) => set({ audio: { mic_mode: v } }))),
      row('播放音量', vol));
  }

  function pluginSection() {
    const list = plugins.length ? plugins.map((p) => h('div', { class: 'plugin' },
      p.icon ? h('img', { src: `${p.base_url}${p.icon}`, alt: '' }) : h('div', { class: 'ph' }, (p.name || '?').slice(0, 1)),
      h('div', { class: 'meta' }, h('div', { class: 'name' }, p.name), h('div', { class: 'sub' }, `${p.type === 'widget' ? '组件' : '应用'} · v${p.version} · ${p.id}`)),
      toggle(p.enabled !== false, (v) => B.call('setPluginEnabled', p.id, v)),
      h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm(`卸载 ${p.name}？`)) B.call('uninstallPlugin', p.id); } }, '卸载')))
      : [h('div', { class: 'empty' }, '尚未安装插件')];
    return h('section', null, h('h2', null, '插件'), h('div', { class: 'card' }, list,
      h('div', { class: 'row' }, h('span', { class: 'hint' }, '支持 .yplug / .zip；电脑端也可推送安装'), h('button', { class: 'btn primary', type: 'button', onclick: () => B.call('pickPluginPackage') }, '导入插件'))));
  }

  function systemSection() {
    const isLauncher = !!info.is_default_launcher;
    return card('桌面与锁屏',
      row('默认桌面', h('div', { class: 'status' }, isLauncher ? '已是默认桌面' : '未设置', h('button', { class: 'btn', type: 'button', onclick: () => B.call('openHomeSettings') }, '去设置'))),
      row('启用桌面抽屉', toggle((cfg.launcher || {}).enabled, (v) => set({ launcher: { enabled: v } })), '竖屏上滑打开应用抽屉（需设为默认桌面）'),
      row('锁屏显示人物', toggle((cfg.lockscreen || {}).enabled, (v) => { B.call('setLockscreenEnabled', v); set({ lockscreen: { enabled: v } }); }), '锁屏下 agent 可控制人物与语音，插件不可用'),
      row('设备别名', text((cfg.device || {}).alias, (v) => set({ device: { alias: v } }), { maxlength: '24' }), '用于 agent 工具前缀，如 mi6'));
  }

  function modelSection() {
    if (!models) return null;
    const enabled = new Set(models.enabled.map((m) => (typeof m === 'string' ? m : m.ref)));
    const refs = models.models.map((m) => ({ ref: m.ref, name: m.name || m.id, provider: m.provider, ok: m.has_api_key !== false }));
    const save = (patch) => api('PUT', '/api/config/models/selection', patch).then(() => { toast('已保存'); return loadModels(); }).catch((e) => toast(`保存失败：${e.message}`));
    return h('section', { class: 'models' }, h('h2', null, '模型'), h('div', { class: 'card' },
      row('当前模型', select(models.active, refs.map((m) => [m.ref, `${m.name} · ${m.provider}`]), (v) => save({ active_model: v }))),
      refs.map((m) => h('label', null,
        h('input', { type: 'checkbox', checked: enabled.has(m.ref), onchange: (e) => { if (e.target.checked) enabled.add(m.ref); else enabled.delete(m.ref); save({ enabled_models: Array.from(enabled) }); } }),
        h('span', null, m.name, ' ', h('small', null, `${m.provider}${m.ok ? '' : ' · 缺少 API key'}`))))));
  }

  function serverBase() { const s = cfg.server || {}; return Address.baseUrl('http', s.host, s.port); }

  async function api(method, path, body) {
    const s = cfg.server || {};
    const res = await fetch(`${serverBase()}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadModels() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3500);
      const s = cfg.server || {};
      const res = await fetch(`${serverBase()}/api/config/models`, { signal: ctl.signal, headers: s.token ? { authorization: `Bearer ${s.token}` } : {} });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      models = SettingsModels.normalizeResponse(await res.json());
      modelsError = models ? '' : '模型接口返回格式无效';
    } catch (err) {
      models = null; // offline: the section is hidden
      modelsError = err.message;
    }
    render();
  }

  function render() {
    const scrollY = window.scrollY;
    const active = document.activeElement;
    if (active && /INPUT|SELECT/.test(active.tagName) && root.contains(active)) active.blur();
    root.replaceChildren(connectionSection(), appearanceSection(), canvasSection(), audioSection(), pluginSection(), systemSection(), modelSection());
    window.scrollTo(0, scrollY);
  }

  B.on('config.changed', (c) => { const hostChanged = JSON.stringify(c.server) !== JSON.stringify(cfg.server); cfg = c; render(); if (hostChanged) loadModels(); });
  B.on('hub.state', (st) => { hub = st; render(); });
  B.on('plugins.changed', () => { plugins = B.json('listPlugins', []); render(); });
  B.on('picker.result', (r) => {
    if (!r) return;
    if (r.error) { toast(r.error); return; }
    if (r.kind === 'background' && (r.url || r.uri)) set({ appearance: { background: { type: 'image', image_url: r.url || r.uri } } });
  });
  B.on('server.discovery.state', (state) => { discovery = state || discovery; render(); });
  B.on('server.discovery.results', (result) => { discoveredServices = result && Array.isArray(result.services) ? result.services : []; render(); });
  document.getElementById('back').onclick = () => B.call('closeSettings');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') B.call('closeSettings'); });
  B.on('back', () => { B.call('consumeBack'); B.call('closeSettings'); });

  plugins = B.json('listPlugins', []);
  render();
  B.start();
  loadModels();
})();
