/* Main screen controller: stage camera, gestures, panels, avatar transfer, voice, canvas, plugin host. */
(function () {
  'use strict';

  const B = window.YachiyoBridge;
  const L = window.YachiyoLayout;
  const T = window.YachiyoTransfer;
  const qs = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const log = (level, msg) => B.log(level, msg);
  const clamp = L.clamp;

  let cfg = B.getConfig();
  const info = B.deviceInfo();
  const deviceId = info.device_id || 'unknown';
  const mode = (qs.get('mode') === 'lockscreen' || info.mode === 'lockscreen') ? 'lockscreen' : 'normal';
  const lockscreen = mode === 'lockscreen';
  document.body.dataset.mode = mode;

  const el = {
    stage: $('stage'), bg: $('bg'), widgetsPanel: $('widgets-panel'), appsPanel: $('apps-panel'), canvas: $('canvas'),
    away: $('away'), awayWhere: $('away-where'), awayCall: $('away-call'), dot: $('hub-dot'),
    mic: $('mic-level'), micBtn: $('btn-mic'), chatBtn: $('btn-chat'), chatForm: $('chat-form'), chatText: $('chat-text'),
    settings: $('btn-settings'), drawer: $('drawer'), menu: $('menu'), toast: $('toast')
  };

  /* ------------------------------------------------------------------ state */
  const S = {
    hub: B.hubState(), view: { w: innerWidth, h: innerHeight }, landscape: innerWidth > innerHeight,
    panelState: 0, drawerOpen: false, sheetOpen: false, editing: false,
    parked: false, exited: false, anim: null, paused: false, firstFrame: true, modelPromise: null, presented: false
  };
  const cam = {
    scale: L.createSpring({ stiffness: 110, damping: 21 }),
    x: L.createSpring({ stiffness: 110, damping: 21 }),
    y: L.createSpring({ stiffness: 110, damping: 21 })
  };
  const panel = L.createSpring({ stiffness: 260, damping: 27 });
  const drawer = L.createSpring({ stiffness: 300, damping: 31 });
  let geom = L.panelGeometry({ viewW: innerWidth, viewH: innerHeight });

  const isHost = () => !(S.hub.state === 'connected' && S.hub.avatar_host && S.hub.avatar_host !== deviceId);
  const stageShown = () => !!stage.model && (S.parked || !!S.anim || (isHost() && !S.exited));

  /* ------------------------------------------------------------------ stage */
  function performanceProfile() {
    return L.resolvePerformanceProfile({
      configured: (cfg.appearance || {}).model_quality,
      lowRam: !!info.low_ram,
      totalMemMb: info.total_mem_mb,
      dpr: window.devicePixelRatio || 1
    });
  }

  const stage = new window.YachiyoStage({
    container: el.stage,
    log,
    performanceProfile: performanceProfile(),
    onContextLost: () => { rebuildStage('contextlost'); }
  });
  // Read-only sampling hook used by scripts/android-profile-live2d.js over an explicitly forwarded CDP port.
  window.__yachiyoPerf = {
    begin: () => stage.beginPerformanceSample(),
    snapshot: () => stage.performanceSnapshot()
  };
  const lipsync = new window.YachiyoLipsync.LipsyncDriver({ stage });
  let actions = null;
  let taskCanvas = null;
  let voice = null;
  let presets = {};
  let manifest = null;

  async function loadJson(url) {
    try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
  }

  function quality() {
    return performanceProfile().quality;
  }

  async function ensureModel() {
    if (S.modelPromise) return S.modelPromise;
    const loadPromise = (async () => {
      manifest = manifest || await loadJson('/generated/manifest.json');
      if (!manifest || !manifest.model) throw new Error('generated/manifest.json missing - run npm run android:sync-assets');
      presets = presets && Object.keys(presets).length ? presets : (await loadJson('/generated/config/live2d-presets.json')) || {};
      if (!stage.app) await stage.init();
      const q = quality();
      const rel = manifest.model.variants[q] || manifest.model.variants[4096];
      await stage.load({ url: `/generated/${rel}`, quality: q, name: manifest.model.name });
      stage.setVisible(false);
      stage.preloadGpu();
      stage.setVisible(false);
      actions = window.YachiyoActions.createActions({ stage, bridge: B, presets, log, getHostInfo: () => ({ avatar_host: S.hub.avatar_host, is_host: isHost(), landscape: S.landscape, panel: S.panelState }) });
      retargetCamera(true);
      return true;
    })();
    const trackedPromise = loadPromise.catch((err) => {
      if (S.modelPromise === trackedPromise) S.modelPromise = null;
      if (err && err.code !== 'STALE_STAGE_LOAD') {
        log('error', `model load failed: ${err.message}`);
        toast(`模型加载失败：${err.message}`);
      }
      throw err;
    });
    S.modelPromise = trackedPromise;
    return S.modelPromise;
  }

  let rebuilding = false;
  async function rebuildStage(reason) {
    if (rebuilding) return;
    rebuilding = true;
    log('warn', `rebuilding stage (${reason})`);
    try {
      const visible = stageShown();
      if (actions) { actions.dispose(); actions = null; }
      lipsync.stop();
      stage.destroy();
      S.modelPromise = null;
      await ensureModel();
      stage.setVisible(visible);
      stage.resize();
      kick();
    } catch (err) { log('error', `rebuild failed: ${err.message}`); } finally { rebuilding = false; }
  }

  /* ------------------------------------------------------------------ camera */
  function focusMode() { return L.resolveFocus({ landscape: S.landscape, config: cfg.appearance || {} }); }

  function cameraTarget() {
    const f = L.computeFrame({ viewW: S.view.w, viewH: S.view.h, content: stage.content, focus: focusMode(), ...(lockscreen ? { marginTop: S.landscape ? 0.04 : 0.22, marginBottom: 0.09 } : {}) });
    return { ...L.placeModel(f), frame: f };
  }

  function retargetCamera(snap) {
    if (!stage.content) return;
    const t = cameraTarget();
    if (snap) { cam.scale.snap(t.scale); cam.x.snap(t.x); cam.y.snap(t.y); } else { cam.scale.to(t.scale); cam.x.to(t.x); cam.y.to(t.y); }
    kick();
  }

  function modelHeightPx() {
    const c = stage.content;
    return c ? (c.y1 - c.y0) * cam.scale.value : S.view.h;
  }

  /* ------------------------------------------------------------------ frame loop */
  let raf = 0;
  let last = 0;
  function kick() { if (!raf && !S.paused) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const busy = step(dt, now);
    if (busy && !S.paused) raf = requestAnimationFrame(frame);
  }

  function transferOffset(now) {
    const dims = { viewH: S.view.h, modelH: modelHeightPx() };
    if (S.anim) {
      const t = now - S.anim.t0;
      const y = S.anim.kind === 'exit' ? T.exitOffset(t, dims) : T.enterOffset(t, dims);
      const dur = S.anim.kind === 'exit' ? T.exitDuration() : T.enterDuration();
      if (t >= dur && !S.anim.done) { S.anim.done = true; const a = S.anim; setTimeout(() => finishAnim(a), 0); }
      return y;
    }
    if (S.parked) return T.offscreenOffset(dims);
    return 0;
  }

  function step(dt, now) {
    let busy = false;
    for (const s of [cam.scale, cam.x, cam.y, panel, drawer]) { if (!s.settled() && !dragging) s.step(dt); if (!s.settled()) busy = true; }
    if (dragging) busy = true;

    const p = lockscreen || !S.landscape ? 0 : panel.value;
    const tr = L.panelTransforms(p, geom);
    applyPanels(tr, p);
    applyDrawer();

    if (stage.model && stage.app) {
      const show = stageShown();
      if (show !== stage.visible) stage.setVisible(show);
      const ty = transferOffset(now);
      if (S.anim || S.parked) busy = true;
      if (show) {
        const c = stage.content;
        const pvx = (c.x0 + c.x1) / 2; const pvy = c.y1;
        const mul = tr.modelScaleMul;
        const sc = cam.scale.value;
        const pose = {
          scale: sc * mul,
          x: cam.x.value + pvx * sc * (1 - mul) + tr.modelDx,
          y: cam.y.value + pvy * sc * (1 - mul) + ty
        };
        lipsync.step();
        stage.render(dt * 1000, pose);
        busy = true;
      } else if (S.firstFrame === false) {
        lipsync.step();
      }
      S.firstFrame = false;
    }
    return busy;
  }

  let lastPanelKey = '';
  function applyPanels(tr, p) {
    const key = `${tr.appsX.toFixed(1)}|${tr.widgetsX.toFixed(1)}|${S.landscape}`;
    if (key === lastPanelKey) return;
    lastPanelKey = key;
    const on = S.landscape && !lockscreen;
    el.appsPanel.style.transform = `translate3d(${tr.appsX}px,0,0)`;
    el.widgetsPanel.style.transform = `translate3d(${tr.widgetsX}px,0,0)`;
    el.appsPanel.style.opacity = on ? tr.appsOpacity : 0;
    el.widgetsPanel.style.opacity = on ? tr.widgetsOpacity : 0;
    el.appsPanel.classList.toggle('live', on && p < -0.5);
    el.widgetsPanel.classList.toggle('live', on && p > 0.5);
  }

  let lastDrawerKey = '';
  function applyDrawer() {
    const q = clamp(drawer.value, -0.05, 1.05);
    const key = q.toFixed(3);
    if (key === lastDrawerKey) return;
    lastDrawerKey = key;
    el.drawer.style.transform = `translate3d(0,${(1 - q) * 100}%,0)`;
    if (q > 0.02 && launcher) launcher.ensureLoaded();
  }

  /* ------------------------------------------------------------------ view / config */
  function onResize() {
    S.view = { w: innerWidth, h: innerHeight };
    const was = S.landscape;
    S.landscape = innerWidth > innerHeight;
    document.body.dataset.landscape = S.landscape ? '1' : '0';
    geom = L.panelGeometry({ viewW: S.view.w, viewH: S.view.h });
    document.documentElement.style.setProperty('--panel-w', `${Math.round(geom.panelW)}px`);
    lastPanelKey = '';
    if (!S.landscape && was) { S.panelState = 0; panel.snap(0); closeSheet(true); }
    stage.resize();
    retargetCamera(false);
    if (plugins) plugins.relayout(geom);
    kick();
  }

  function applyConfig() {
    const bg = (cfg.appearance || {}).background || {};
    if (bg.type === 'image' && bg.image_url) {
      el.bg.style.backgroundImage = `url("${bg.image_url}")`;
      el.bg.style.backgroundColor = bg.color || '';
    } else {
      el.bg.style.backgroundImage = 'none';
      el.bg.style.backgroundColor = bg.color || '#1d2233';
    }
    const tc = cfg.task_canvas || {};
    document.body.dataset.pos = tc.position || 'top';
    document.documentElement.style.setProperty('--tc-opacity', String(tc.opacity ?? 0.85));
    document.body.dataset.launcher = !lockscreen && (cfg.launcher || {}).enabled ? '1' : '0';
    if (voice) { /* volume is read on next playback */ }
  }

  /* ------------------------------------------------------------------ gestures */
  const tracker = L.createGestureTracker({ slop: 10 });
  let dragging = null;   // 'panel' | 'drawer' | null
  let press = null;
  let longTimer = 0;
  const IGNORE = 'button,input,textarea,form,.sheet,.menu,.away-card,.drawer-list,.widget-card,.toast';

  const panelsEnabled = () => !lockscreen && S.landscape && !S.sheetOpen && !S.drawerOpen && !S.editing;
  const drawerEnabled = () => !lockscreen && (cfg.launcher || {}).enabled && !S.sheetOpen && S.panelState === 0;
  const drawerRange = () => S.view.h * 0.55;

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest(IGNORE)) { press = null; return; }
    closeMenu();
    unlockAudio();
    tracker.down(e.clientX, e.clientY, e.timeStamp);
    press = { x: e.clientX, y: e.clientY, t: e.timeStamp, startP: panel.value, startQ: drawer.value, hit: stage.hitTest(e.clientX, e.clientY), moved: false, axis: null };
    clearTimeout(longTimer);
    if (press.hit) longTimer = setTimeout(() => { if (press && !press.moved) { press.long = true; openMenu(press.x, press.y); } }, 520);
  }

  function onMove(e) {
    if (!press) return;
    const r = tracker.move(e.clientX, e.clientY, e.timeStamp);
    if (!r) return;
    if (Math.hypot(r.dx, r.dy) > 10) { press.moved = true; clearTimeout(longTimer); }
    if (!dragging && r.axis && !press.axis) {
      press.axis = r.axis;
      if (r.axis === 'x' && panelsEnabled()) dragging = 'panel';
      else if (r.axis === 'y' && drawerEnabled() && (r.dy < 0 || S.drawerOpen)) dragging = 'drawer';
      else if (r.axis === 'y' && S.drawerOpen) dragging = 'drawer';
      if (dragging) { press.startP = panel.value; press.startQ = drawer.value; kick(); }
    }
    if (dragging === 'panel') {
      panel.snap(L.rubberband(press.startP + r.dx / geom.panelW));
    } else if (dragging === 'drawer') {
      const v = press.startQ - r.dy / drawerRange();
      drawer.snap(v < 0 ? v * 0.2 : (v > 1 ? 1 + (v - 1) * 0.2 : v));
    } else if (e.pointerType === 'mouse' || !press.moved) {
      stage.lookAt(e.clientX, e.clientY);
    }
  }

  function onUp(e) {
    clearTimeout(longTimer);
    if (!press) return;
    const r = tracker.up();
    const p = press;
    press = null;
    if (dragging === 'panel') {
      const target = L.resolvePanelSnap({ progress: panel.value, velocity: r.vx / geom.panelW, from: S.panelState });
      S.panelState = target;
      panel.to(target, r.vx / geom.panelW);
      dragging = null;
    } else if (dragging === 'drawer') {
      const target = L.resolveDrawerSnap({ progress: drawer.value, velocity: -r.vy / drawerRange() });
      S.drawerOpen = target === 1;
      drawer.to(target, -r.vy / drawerRange());
      dragging = null;
    } else if (lockscreen && r.axis === 'y' && r.vy < -600) {
      B.call('dismissKeyguard');
    } else if (!p.moved && !p.long && e.timeStamp - p.t < 400) {
      onTap(e.clientX, e.clientY, p.hit);
    }
    kick();
  }

  function onCancel() {
    clearTimeout(longTimer);
    tracker.up();
    if (dragging === 'panel') { panel.to(S.panelState); }
    if (dragging === 'drawer') { drawer.to(S.drawerOpen ? 1 : 0); }
    dragging = null;
    press = null;
    kick();
  }

  function onTap(x, y, hit) {
    if (S.drawerOpen) { setDrawer(false); return; }
    if (S.panelState !== 0) {
      // Tap on the character area (the side not covered by the open panel) closes it.
      const covered = S.panelState < 0 ? x > S.view.w - geom.panelW : x < geom.panelW;
      if (!covered) { setPanel(0); return; }
    }
    if (hit && actions) {
      if (hit === 'head') { actions.act({ type: 'expression', name: 'smile' }, 2.5); B.call('vibrate', 12); }
      else actions.act({ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3);
    }
  }

  function setPanel(target) {
    if (!panelsEnabled() && target !== 0) return;
    S.panelState = target;
    panel.to(target);
    kick();
  }

  function setDrawer(open) {
    S.drawerOpen = open;
    drawer.to(open ? 1 : 0);
    if (open) launcher && launcher.ensureLoaded();
    kick();
  }

  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onCancel, { passive: true });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ------------------------------------------------------------------ menu / toast */
  function openMenu(x, y) {
    const items = [];
    if (S.hub.state === 'connected') items.push(['去电脑那边', () => transferTo('desktop')]);
    if (!lockscreen) items.push(['设置', () => B.call('openSettings')]);
    items.push(['打招呼', () => actions && actions.act({ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3)]);
    el.menu.replaceChildren(...items.map(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { closeMenu(); fn(); };
      return b;
    }));
    el.menu.hidden = false;
    const w = 170; const h = items.length * 44 + 12;
    el.menu.style.left = `${clamp(x - w / 2, 8, S.view.w - w - 8)}px`;
    el.menu.style.top = `${clamp(y - h - 12, 8, S.view.h - h - 8)}px`;
    B.call('vibrate', 15);
  }
  function closeMenu() { el.menu.hidden = true; }

  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------------------ avatar transfer (C1.5) */
  function transferTo(to) {
    return B.rpc('avatar.transfer', { to }, '', 12000).catch((err) => toast(`移交失败：${err.message}`));
  }

  function runAnim(kind, id) {
    return new Promise((resolve) => {
      S.anim = { kind, id, t0: performance.now(), done: false, resolve };
      if (kind === 'enter') { S.parked = false; S.exited = false; }
      kick();
    });
  }

  function finishAnim(a) {
    if (S.anim !== a) return;
    S.anim = null;
    if (a.kind === 'exit') S.exited = true;
    refreshAway();
    a.resolve();
    kick();
  }

  async function onPrepare(d) {
    if (!d || (d.to && d.to !== deviceId)) return;
    try { await ensureModel(); } catch { return; }
    S.parked = true;
    S.exited = false;
    refreshAway();
    kick();
    B.publish('avatar.transfer.ready', { transfer_id: d.transfer_id });
  }

  async function onExit(d) {
    if (!d || !stage.model) { if (d) B.publish('avatar.transfer.exited', { transfer_id: d.transfer_id }); return; }
    await runAnim('exit', d.transfer_id);
    B.publish('avatar.transfer.exited', { transfer_id: d.transfer_id });
  }

  async function onEnter(d) {
    if (!d) return;
    try { await ensureModel(); } catch { B.publish('avatar.transfer.entered', { transfer_id: d.transfer_id }); return; }
    await runAnim('enter', d.transfer_id);
    if (actions) actions.act({ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3);
    B.publish('avatar.transfer.entered', { transfer_id: d.transfer_id });
  }

  async function onCancel2() {
    if (S.parked) { S.parked = false; refreshAway(); kick(); return; }
    if (S.exited || S.anim) { S.anim = null; await runAnim('enter', 'cancel'); }
  }

  function refreshAway() {
    const away = !lockscreen && (!isHost() || S.exited) && !S.parked && !S.anim;
    el.away.hidden = !away;
    if (away) el.awayWhere.textContent = S.hub.avatar_host === 'desktop' || !S.hub.avatar_host ? '电脑' : '另一台设备';
  }
  el.awayCall.onclick = () => { transferTo(deviceId); };

  /* ------------------------------------------------------------------ hub state */
  function onHubState(st) {
    const wasHost = isHost();
    S.hub = st || S.hub;
    el.dot.dataset.state = S.hub.state;
    if (!isHost()) S.exited = false;
    refreshAway();
    if (S.presented && !wasHost && isHost() && !S.parked && !S.anim) { // became host without a transfer sequence
      ensureModel().then(() => { runAnim('enter', 'host'); });
    }
    kick();
  }

  /* ------------------------------------------------------------------ mic / chat */
  let micDownAt = 0;
  let micOn = false;
  function micStart() {
    if (micOn) return;
    micOn = true;
    micDownAt = performance.now();
    el.micBtn.classList.add('rec');
    B.call('micStart', JSON.stringify({ mode: (cfg.audio || {}).mic_mode || 'push_to_talk' }));
    B.call('vibrate', 10);
  }
  function micStop(reason) {
    if (!micOn) return;
    micOn = false;
    el.micBtn.classList.remove('rec');
    el.micBtn.style.setProperty('--lvl', 1);
    B.call('micStop', reason);
  }
  el.micBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    if (((cfg.audio || {}).mic_mode) === 'continuous') { micOn ? micStop('released') : micStart(); return; }
    el.micBtn.setPointerCapture(e.pointerId);
    micStart();
  });
  const micRelease = () => {
    if (((cfg.audio || {}).mic_mode) === 'continuous' || !micOn) return;
    const short = performance.now() - micDownAt < 280;
    micStop(short ? 'cancel' : 'released');
    if (short) toast('按住说话');
  };
  el.micBtn.addEventListener('pointerup', micRelease);
  el.micBtn.addEventListener('pointercancel', micRelease);
  B.on('mic.level', (d) => { if (micOn) el.mic.style.setProperty('--lvl', (1 + clamp(d.rms || 0, 0, 1) * 0.6).toFixed(3)); });
  B.on('mic.state', (d) => {
    if (d.state === 'error') { micStop('cancel'); toast(`麦克风错误：${d.error || ''}`); }
    if (d.state === 'idle' && micOn && ((cfg.audio || {}).mic_mode) !== 'continuous') { micOn = false; el.micBtn.classList.remove('rec'); }
  });

  el.chatBtn.onclick = () => { document.body.dataset.chat = '1'; el.chatForm.classList.add('open'); el.chatText.focus(); };
  el.chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = el.chatText.value.trim();
    if (!text) return;
    B.publish('chat.input', { text });
    taskCanvas.showUser(text);
    el.chatText.value = '';
  };
  el.chatText.addEventListener('blur', () => setTimeout(() => { if (!el.chatText.value) { el.chatForm.classList.remove('open'); document.body.dataset.chat = '0'; } }, 150));
  el.settings.onclick = () => B.call('openSettings');
  $('btn-unlock').onclick = () => B.call('dismissKeyguard');

  function unlockAudio() { if (voice) voice.unlock(); }

  /* ------------------------------------------------------------------ plugin sheet bridge */
  let plugins = null;
  let launcher = null;
  function closeSheet(immediate) { if (plugins && S.sheetOpen) plugins.closeApp(immediate); }

  /* ------------------------------------------------------------------ back key */
  function consumeBack() {
    if (!el.menu.hidden) { closeMenu(); return true; }
    if (S.sheetOpen) { plugins.closeApp(); return true; }
    if (S.editing) { plugins.setEditing(false); return true; }
    if (S.drawerOpen) { setDrawer(false); return true; }
    if (S.panelState !== 0) { setPanel(0); return true; }
    return false;
  }
  B.on('back', () => { if (consumeBack()) B.call('consumeBack'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') consumeBack(); });

  /* ------------------------------------------------------------------ lifecycle */
  B.on('lifecycle', (d) => {
    if (!d) return;
    if (d.state === 'pause' || d.state === 'screen_off') { S.paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    if (d.state === 'resume' || d.state === 'screen_on') {
      S.paused = false;
      const gl = stage.app && stage.app.renderer && stage.app.renderer.gl;
      if (gl && gl.isContextLost && gl.isContextLost()) rebuildStage('resume-context-lost');
      kick();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.paused = true; } else { S.paused = false; const gl = stage.app && stage.app.renderer && stage.app.renderer.gl; if (gl && gl.isContextLost && gl.isContextLost()) rebuildStage('visible-context-lost'); kick(); }
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 60));
  B.on('config.changed', (c) => {
    const q = quality();
    cfg = c;
    stage.performanceProfile = performanceProfile();
    applyConfig();
    if (stage.model && quality() !== q) rebuildStage('quality-changed');
    retargetCamera(false);
  });
  B.on('hub.state', onHubState);
  B.on('plugins.changed', () => { if (plugins) plugins.refresh(); });

  /* ------------------------------------------------------------------ lockscreen clock */
  function tickClock() {
    const d = new Date();
    $('lock-time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('lock-date').textContent = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  }

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    applyConfig();
    onResize();
    el.dot.dataset.state = S.hub.state;

    const taskCanvasApi = window.YachiyoTaskCanvas.createCanvas({ root: el.canvas });
    taskCanvas = taskCanvasApi;
    voice = window.YachiyoVoice.createVoice({ bridge: B, lipsync, getConfig: () => cfg, log });

    B.subscribe('chat.delta', (d) => taskCanvasApi.delta(d && d.delta));
    B.subscribe('chat.final', (d) => taskCanvasApi.final(d && d.output));
    B.subscribe('task.update', (d) => taskCanvasApi.updateTask(d));
    B.subscribe('audio.input.transcript', (d) => { if (d && d.final && d.text) taskCanvasApi.showUser(d.text); if (d && d.error) toast(`识别失败：${d.error}`); });
    B.subscribe('avatar.**', (d, ev) => {
      switch (ev.topic) {
        case 'avatar.transfer.prepare': onPrepare(d); break;
        case 'avatar.transfer.exit': onExit(d); break;
        case 'avatar.transfer.enter': onEnter(d); break;
        case 'avatar.transfer.cancel': onCancel2(); break;
        case 'avatar.host.changed': if (d && d.host) onHubState({ ...S.hub, avatar_host: d.host }); break;
        case 'avatar.transfer.failed': toast(`移交失败：${(d && d.reason) || ''}`); break;
        default:
      }
    });
    B.subscribe('sys.device.*', () => {});

    if (!lockscreen) {
      plugins = window.YachiyoPluginHost.create({
        bridge: B, geom, getTheme: () => ({ mode: 'dark', accent: '#7aa2ff' }), toast,
        els: { appsGrid: $('apps-grid'), appsEmpty: $('apps-empty'), widgetsGrid: $('widgets-grid'), widgetsEmpty: $('widgets-empty'), widgetsEdit: $('widgets-edit'), widgetsPanel: el.widgetsPanel, sheet: $('sheet'), sheetBody: $('sheet-body'), sheetTitle: $('sheet-title'), sheetClose: $('sheet-close'), sheetExpand: $('sheet-expand') },
        getConfig: () => cfg,
        onSheet: (open) => { S.sheetOpen = open; if (open) { S.panelState = -1; panel.to(-1); } kick(); },
        onEditing: (v) => { S.editing = v; if (v) { S.panelState = 1; panel.to(1); } kick(); },
        actions: () => actions,
        openApp: () => { S.panelState = -1; panel.to(-1); kick(); }
      });
      launcher = window.YachiyoLauncher.create({ list: $('drawer-list'), search: $('drawer-search'), bridge: B, onLaunch: () => setDrawer(false) });
      plugins.refresh();
    } else {
      tickClock();
      setInterval(tickClock, 15000);
    }

    B.start();
    if (qs.get('debug') === '1') { const s = document.createElement('script'); s.src = 'js/debug.js'; document.body.appendChild(s); }

    // Let the hub settle before deciding who shows the character (avoids a flash on non-host devices).
    const wantHub = (cfg.server || {}).auto_connect && S.hub.state !== 'connected';
    if (wantHub) await new Promise((r) => { const off = B.on('hub.state', (s) => { if (s && s.state !== 'connecting') { off(); r(); } }); setTimeout(r, 1800); });
    S.hub = B.hubState();
    el.dot.dataset.state = S.hub.state;
    refreshAway();

    try {
      await ensureModel();
      S.presented = true;
      if (isHost()) await runAnim('enter', 'startup');
      if (actions && isHost()) actions.act({ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3);
    } catch { /* toast already shown */ }
    kick();
  }

  window.YachiyoApp = {
    get plugins() { return plugins; },
    S, stage, cam, panel, drawer, kick, setPanel, setDrawer, toast, rebuildStage, ensureModel,
    get actions() { return actions; }, get voice() { return voice; }, lipsync,
    onPrepare, onExit, onEnter, onCancel: onCancel2, onHubState
  };

  boot();
})();
