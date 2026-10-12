(function expose(root) {
  function createDevicesApi({ fetchImpl = fetch, base = '', getToken = () => '' } = {}) {
    async function request(route, options = {}) {
      const token = getToken();
      const response = await fetchImpl(`${base}/api/device${route}`, { ...options, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers } });
      if (!response.ok) {
        let message = `请求失败 (${response.status})`;
        try { message = (await response.json()).error?.message || message; } catch { /* HTTP error may be empty. */ }
        throw Object.assign(new Error(message), { status: response.status });
      }
      return response.json();
    }
    return {
      pairing: () => request('/pairing'), devices: () => request('/devices'), plugins: () => request('/plugins'),
      transfer: (to) => request('/avatar/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) }),
      upload: (file) => request('/plugins', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file }),
      push: (sha, target) => request(`/plugins/${encodeURIComponent(sha)}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: target || undefined }) })
    };
  }
  if (typeof module === 'object' && module.exports) { module.exports = { createDevicesApi }; return; }
  const $ = (id) => document.getElementById(id);
  let token = ''; let busy = false;
  const api = createDevicesApi({ getToken: () => token });
  const status = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = String(error); };
  function element(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text || ''; if (className) el.className = className; return el;
  }
  async function action(task, message) {
    if (busy) return;
    busy = true; document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    status('正在处理，请稍候…');
    try { await task(); status(message); await refresh(); }
    catch (err) { status(err.message, true); }
    finally { busy = false; document.querySelectorAll('button').forEach((button) => { button.disabled = button.dataset.unavailable === 'true'; }); }
  }
  async function refresh() {
    const [{ devices, avatar_host: host }, { plugins }] = await Promise.all([api.devices(), api.plugins()]);
    $('authorization').hidden = true;
    const hostDevice = devices.find((d) => host === 'desktop' ? d.device_type === 'desktop' : d.device_id === host);
    $('avatar-host').textContent = hostDevice?.name || (host === 'desktop' ? '电脑（未连接）' : `${host}（离线）`);
    $('devices').replaceChildren(); $('empty-devices').hidden = devices.length > 0;
    const oldTarget = $('plugin-target').value;
    $('plugin-target').replaceChildren(new Option('全部未锁屏手机', ''));
    for (const device of devices) {
      const current = device === hostDevice;
      const card = element('div', '', `device${current ? ' active' : ''}`); const details = element('div', '', 'details');
      details.append(element('strong', device.name), element('span', `${device.device_type} · ${device.mode === 'lockscreen' ? '锁屏' : '在线'} · ${device.device_id}`));
      const button = element('button', current ? '当前设备' : '移交到这里'); button.type = 'button'; button.dataset.unavailable = String(current); button.disabled = current || busy;
      button.onclick = () => action(() => api.transfer(device.device_type === 'desktop' ? 'desktop' : device.device_id), `已移交到 ${device.name}`);
      card.append(details, button); $('devices').append(card);
      if (device.device_type === 'android' && device.mode !== 'lockscreen') $('plugin-target').append(new Option(device.name, device.device_id));
    }
    if ([...$('plugin-target').options].some((option) => option.value === oldTarget)) $('plugin-target').value = oldTarget;
    $('plugins').replaceChildren();
    for (const plugin of plugins) {
      const card = element('div', '', 'plugin'); const details = element('div', '', 'details');
      details.append(element('strong', plugin.manifest.name), element('span', `${plugin.manifest.version} · ${plugin.manifest.type} · ${Math.ceil(plugin.size / 1024)} KB`));
      const button = element('button', '推送'); button.type = 'button'; button.disabled = busy;
      button.onclick = () => action(async () => { const result = await api.push(plugin.sha256, $('plugin-target').value); if (!result.targets.length) throw new Error('暂无可接收的手机'); }, '推送请求已发送，请在手机确认安装结果。');
      card.append(details, button); $('plugins').append(card);
    }
    if (!plugins.length) $('plugins').append(element('p', '还没有上传插件。', 'hint'));
  }
  $('auth-form').onsubmit = (event) => { event.preventDefault(); token = $('auth-token').value.trim(); void action(refresh, '已连接网关'); };
  $('refresh').onclick = () => action(refresh, '设备列表已更新');
  $('recall').onclick = () => action(() => api.transfer('desktop'), '已接回电脑');
  $('upload-form').onsubmit = (event) => {
    event.preventDefault(); const file = $('plugin-file').files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { status('插件包不能超过 20 MiB', true); return; }
    void action(() => api.upload(file), '插件已上传，可选择手机推送。');
  };
  $('show-token').onclick = () => { const hidden = $('pairing-token').type === 'password'; $('pairing-token').type = hidden ? 'text' : 'password'; $('show-token').textContent = hidden ? '隐藏' : '显示'; };
  $('copy-token').onclick = async () => { try { await navigator.clipboard.writeText($('pairing-token').value); status('配对 token 已复制'); } catch { status('无法访问剪贴板，请显示后手动复制。', true); } };
  async function init() {
    try {
      const pairing = await api.pairing();
      token = pairing.token; $('pairing-token').value = token; $('pairing').hidden = false; $('pairing-note').textContent = '请选择手机可以访问的局域网地址。';
      const urls = [...pairing.urls].sort((a, b) => Number(a.includes('127.0.0.1')) - Number(b.includes('127.0.0.1')));
      for (const url of urls) $('pairing-url').append(new Option(url, url));
    } catch { $('authorization').hidden = false; }
    try { await refresh(); status('设备列表每 5 秒自动更新'); }
    catch (err) { $('authorization').hidden = false; status('请输入配对 token 连接网关', true); }
    setInterval(() => { if (!busy) void refresh().catch((err) => { if (err.status === 403) $('authorization').hidden = false; status('连接中断，请检查网关或刷新重试。', true); }); }, 5000);
  }
  void init();
})(typeof window === 'undefined' ? globalThis : window);
