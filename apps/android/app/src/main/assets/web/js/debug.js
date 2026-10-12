/* Offline simulator panel (?debug=1): drives the UI with synthetic hub events. Development only. */
(function () {
  'use strict';
  const B = window.YachiyoBridge;
  const A = window.YachiyoApp;
  const deviceId = B.deviceInfo().device_id;
  const ev = (topic, data) => window.__yachiyoNative.dispatch({ type: 'hub.event', data: { topic, data, from: 'gateway' } });
  const hubState = (host, state = 'connected') => window.__yachiyoNative.dispatch({ type: 'hub.state', data: { state, url: 'sim', avatar_host: host, devices: [] } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let tid = 0;

  async function toDesktop() {
    const id = `sim${++tid}`;
    hubState(deviceId);
    ev('avatar.transfer.exit', { transfer_id: id, to: 'desktop' });
    await sleep(900);
    hubState('desktop');
  }
  async function fromDesktop() {
    const id = `sim${++tid}`;
    hubState('desktop');
    await sleep(100);
    ev('avatar.transfer.prepare', { transfer_id: id, from: 'desktop', to: deviceId });
    await sleep(900);
    hubState(deviceId);
    ev('avatar.transfer.enter', { transfer_id: id, from: 'desktop' });
  }

  function wav(seconds = 2.4, rate = 16000) {
    const n = Math.floor(seconds * rate);
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i += 1) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i += 1) {
      const t = i / rate;
      const syll = Math.max(0, Math.sin(t * 2 * Math.PI * 3.2)); // syllable envelope
      const f = 220 + 140 * Math.sin(t * 5);
      const s = syll * (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2.4 * t) * 0.25 + Math.sin(2 * Math.PI * f * 4.1 * t) * 0.15);
      dv.setInt16(44 + i * 2, s * 14000, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  async function chatDemo() {
    ev('chat.delta', { delta: '你好呀，' });
    await sleep(300); ev('chat.delta', { delta: '今天想让我帮你做点什么？' });
    await sleep(500); ev('chat.final', { output: '你好呀，今天想让我帮你做点什么？' });
  }
  async function taskDemo() {
    const base = { task_id: 't1', title: '整理桌面截图', status: 'running' };
    ev('task.update', { ...base, steps: [{ name: '读取文件夹', status: 'running' }] });
    await sleep(900); ev('task.update', { ...base, steps: [{ name: '读取文件夹', status: 'done' }, { name: '归类', status: 'running' }] });
    await sleep(900); ev('task.update', { ...base, status: 'done', steps: [{ name: '读取文件夹', status: 'done' }, { name: '归类', status: 'done' }] });
  }

  const buttons = [
    ['host→电脑', toDesktop], ['电脑→本机', fromDesktop], ['取消(恢复)', () => ev('avatar.transfer.cancel', { transfer_id: 'x' })],
    ['说话(音频)', () => ev('voice.play', { request_id: `v${++tid}`, url: wav() })],
    ['聊天', chatDemo], ['任务', taskDemo], ['转写', () => ev('audio.input.transcript', { stream_id: 's', text: '帮我整理一下桌面', final: true })],
    ['happy', () => ev('ui.live2d.action', { action: { type: 'emote', name: 'happy' }, duration_sec: 3, queue_policy: 'replace' })],
    ['sad', () => ev('ui.live2d.action', { action: { type: 'emote', name: 'sad' }, duration_sec: 3, queue_policy: 'replace' })],
    ['丢失GL', () => A.stage.loseContext()],
    ['面板←', () => A.setPanel(-1)], ['面板→', () => A.setPanel(1)], ['面板0', () => A.setPanel(0)], ['抽屉', () => A.setDrawer(!A.S.drawerOpen)]
  ];
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:50;left:6px;top:34px;display:none;flex-wrap:wrap;gap:4px;max-width:70vw;padding:6px;background:rgba(0,0,0,.7);border-radius:10px;font-size:11px';
  buttons.forEach(([label, fn]) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:5px 8px;background:#334;border-radius:6px;color:#fff;font-size:11px'; b.onclick = (e) => { e.stopPropagation(); fn(); }; box.appendChild(b); });
  const toggle = document.createElement('button');
  toggle.textContent = 'dbg';
  toggle.style.cssText = 'position:fixed;z-index:51;left:6px;top:8px;padding:3px 8px;background:#334;color:#fff;border-radius:6px;font-size:11px;opacity:.7';
  toggle.onclick = () => { box.style.display = box.style.display === 'none' ? 'flex' : 'none'; };
  document.body.append(box, toggle);
  window.YachiyoDebug = { toDesktop, fromDesktop, ev, hubState, wav, chatDemo, taskDemo, sleep };
})();
