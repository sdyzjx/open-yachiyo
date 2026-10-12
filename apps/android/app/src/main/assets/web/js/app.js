/* Main screen controller: stage camera, gestures, panels, avatar transfer, voice, canvas, plugin host. */
(function () {
  'use strict';

  const B = window.YachiyoBridge;
  const L = window.YachiyoLayout;
  const T = window.YachiyoTransfer;
  const TC = window.YachiyoTransferControl;
  const O = window.YachiyoAvatarOwnerState;
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
    transfer: $('btn-transfer'), transferReason: $('transfer-reason'),
    mic: $('mic-level'), micBtn: $('btn-mic'), chatBtn: $('btn-chat'), chatForm: $('chat-form'), chatText: $('chat-text'),
    chatModel: $('chat-model'), modelModeBadge: $('model-mode-badge'),
    activeModelBadge: $('active-model-badge'), activeModelName: $('active-model-name'), activeModelMode: $('active-model-mode'),
    settings: $('btn-settings'), sheet: $('sheet'), drawer: $('drawer'), menu: $('menu'), toast: $('toast')
  };

  /* ------------------------------------------------------------------ state */
  const S = {
    hub: B.hubState(), view: { w: innerWidth, h: innerHeight }, landscape: innerWidth > innerHeight,
    ime: { visible: false, css: 0 }, panelState: 0, drawerOpen: false, sheetOpen: false, editing: false,
    parked: false, exited: false, anim: null, paused: false, firstFrame: true, modelPromise: null, presented: false,
    transferRequestPending: false, modelCatalog: null, selectedModelRef: ''
  };

  function selectedModel() {
    return (S.modelCatalog?.models || []).find((model) => model.ref === S.selectedModelRef) || null;
  }

  function audioModeForSelectedModel() {
    const model = selectedModel();
    if (!model || !(model.input || []).includes('audio')) return 'transcribe';
    return model.transport === 'realtime' || model.audio?.mode === 'realtime' ? 'realtime' : 'direct';
  }

  function renderModelCatalog() {
    if (!el.chatModel) return;
    const models = Array.isArray(S.modelCatalog?.models) ? S.modelCatalog.models : [];
    el.chatModel.replaceChildren();
    if (!models.length) {
      el.chatModel.append(new Option('没有已启用模型', ''));
      el.chatModel.disabled = true;
      if (el.activeModelName) el.activeModelName.textContent = '没有可用模型';
      if (el.activeModelBadge) el.activeModelBadge.disabled = true;
      return;
    }
    for (const model of models) {
      const suffix = model.transport === 'realtime' ? ' · 实时语音' : (model.input || []).includes('audio') ? ' · 音频直通' : '';
      el.chatModel.append(new Option(`${model.name || model.id}${suffix}`, model.ref));
    }
    if (!S.selectedModelRef || !models.some((model) => model.ref === S.selectedModelRef)) {
      S.selectedModelRef = S.modelCatalog.active || models[0].ref;
    }
    el.chatModel.value = S.selectedModelRef;
    el.chatModel.disabled = false;
    const modeName = { transcribe: '转写', direct: '直通', realtime: '实时' }[audioModeForSelectedModel()];
    if (el.modelModeBadge) el.modelModeBadge.textContent = modeName;
    const active = selectedModel();
    if (el.activeModelName) el.activeModelName.textContent = active?.name || active?.id || '选择模型';
    if (el.activeModelMode) el.activeModelMode.textContent = modeName;
    if (el.activeModelBadge) {
      el.activeModelBadge.disabled = false;
      el.activeModelBadge.dataset.mode = audioModeForSelectedModel();
    }
  }

  async function loadModelCatalog() {
    if (lockscreen || S.hub.state !== 'connected') return;
    try {
      S.modelCatalog = await B.rpc('model.catalog.get', {}, '', 8000);
      renderModelCatalog();
    } catch (err) {
      if (el.chatModel) el.chatModel.replaceChildren(new Option('模型加载失败', ''));
      log('warn', `model catalog: ${err && err.message}`);
    }
  }
  const ownerTracker = O.createOwnerTracker({ deviceId, initialHub: S.hub });
  const transferEvents = TC.createTransferEventGuard();
  const cam = {
    scale: L.createSpring({ stiffness: 110, damping: 21 }),
    x: L.createSpring({ stiffness: 110, damping: 21 }),
    y: L.createSpring({ stiffness: 110, damping: 21 })
  };
  const panel = L.createSpring({ stiffness: 260, damping: 27 });
  const drawer = L.createSpring({ stiffness: 300, damping: 31 });
  const chatOrientation = L.createSpring({ value: 1, stiffness: 110, damping: 21 });
  let geom = L.panelGeometry({ viewW: innerWidth, viewH: innerHeight });

  const isHost = () => ownerTracker.snapshot().isHost;
  const stageShown = () => !!stage.model && (S.parked || !!S.anim || (isHost() && !S.exited));

  /* ------------------------------------------------------------------ stage */
  const stage = new window.YachiyoStage({ container: el.stage, log, onContextLost: () => { rebuildStage('contextlost'); } });
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
    return L.resolveQuality({ configured: (cfg.appearance || {}).model_quality, lowRam: !!info.low_ram, totalMemMb: info.total_mem_mb });
  }

  async function ensureModel() {
    if (S.modelPromise) return S.modelPromise;
    S.modelPromise = (async () => {
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
    })().catch((err) => { S.modelPromise = null; log('error', `model load failed: ${err.message}`); toast(`模型加载失败：${err.message}`); throw err; });
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
    updateChatLayout();
    kick();
  }

  /* Chat panel (B6/B9): pure endpoint layouts, interpolated with the stage panel progress. */
  let sabProbe = null;
  function safeBottomPx() {
    if (!sabProbe) {
      sabProbe = document.createElement('div');
      sabProbe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
      document.body.appendChild(sabProbe);
    }
    return sabProbe.offsetHeight || 0;
  }
  let lastChatPresentation = null;
  let chatOrientationFrom = null;
  let lastChatKey = '';

  function elementRect(node) {
    if (!node || node.hidden || getComputedStyle(node).display === 'none') return null;
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function chatInputRect() {
    const sab = safeBottomPx();
    const reserve = S.landscape ? 78 : 92;
    const top = S.view.h - sab - S.ime.css - reserve;
    return { left: 0, top, right: S.view.w, bottom: S.view.h };
  }

  function modelPose(tr, transferY = 0) {
    const c = stage.content;
    const pvx = (c.x0 + c.x1) / 2;
    const pvy = c.y1;
    const mul = tr.modelScaleMul;
    const sc = cam.scale.value;
    return {
      scale: sc * mul,
      x: cam.x.value + pvx * sc * (1 - mul) + tr.modelDx,
      y: cam.y.value + pvy * sc * (1 - mul) + transferY
    };
  }

  function chatEndpoint(panelState) {
    const fallback = S.landscape
      ? { left: S.view.w * 0.4, top: S.view.h * 0.04, right: S.view.w * 0.6, bottom: S.view.h * 1.2 }
      : { left: S.view.w * 0.25, top: S.view.h * 0.04, right: S.view.w * 0.75, bottom: S.view.h * 0.94 };
    const pose = stage.content ? modelPose(L.panelTransforms(panelState, geom)) : null;
    const bounds = pose ? L.modelScreenBounds({ content: stage.content, ...pose }) : fallback;
    const sidePanel = panelState < 0
      ? { left: S.view.w - geom.panelW, top: 0, right: S.view.w, bottom: S.view.h }
      : { left: 0, top: 0, right: geom.panelW, bottom: S.view.h };
    const hud = chatHud();
    return L.computeChatPanelLayout({
      viewport: { width: S.view.w, height: S.view.h }, modelBounds: bounds, panelState,
      panelWidth: geom.panelW, sidePanel, hud,
      preferredSide: (cfg.task_canvas || {}).position === 'right' ? 'right' : 'left'
    });
  }

  function chatHud() {
    return {
      input: chatInputRect(),
      status: elementRect(el.dot),
      transfer: elementRect(el.transfer && el.transfer.closest('.transfer-control')),
      settings: elementRect(el.settings),
      mic: elementRect(el.micBtn),
      chat: elementRect(el.chatBtn),
      send: elementRect(el.chatForm && el.chatForm.querySelector('button[type="submit"]')),
      pluginPanel: S.sheetOpen ? elementRect(el.sheet) : null
    };
  }

  function chatSplitEndpoint() {
    const fallback = { left: S.view.w * 0.4, top: S.view.h * 0.04, right: S.view.w * 0.6, bottom: S.view.h * 1.2 };
    const pose = stage.content ? modelPose(L.panelTransforms(0, geom)) : null;
    const bounds = pose ? L.modelScreenBounds({ content: stage.content, ...pose }) : fallback;
    return L.computeChatSplitLayout({
      viewport: { width: S.view.w, height: S.view.h }, modelBounds: bounds, hud: chatHud()
    });
  }

  function containChatLayout(layout, safe) {
    const out = { ...layout, style: { ...layout.style } };
    out.left = Math.max(out.left, safe.left);
    out.top = Math.max(out.top, safe.top);
    out.right = Math.min(out.right, safe.right);
    out.bottom = Math.min(out.bottom, safe.bottom);
    out.width = Math.max(0, out.right - out.left);
    out.height = Math.max(0, out.bottom - out.top);
    out.hidden = out.width < 96 || out.height < 56;
    return out;
  }

  function applyChatLayout(progress) {
    if (!el.canvas) return;
    const p = S.landscape ? clamp(progress, -1, 1) : 0;
    let presentation;
    if (S.landscape) {
      const split = chatSplitEndpoint();
      const merged = chatEndpoint(p < 0 ? -1 : 1);
      presentation = L.interpolateSplitChatLayout({ split, merged, progress: Math.abs(p) });
    } else {
      presentation = L.singleChatPresentation(chatEndpoint(0));
    }
    if (chatOrientationFrom && !chatOrientation.settled()) {
      const safe = presentation;
      presentation = L.interpolateChatPresentation(chatOrientationFrom, presentation, chatOrientation.value);
      for (const key of ['agent', 'user', 'merged']) presentation[key] = containChatLayout(presentation[key], safe[key]);
    } else if (chatOrientation.settled()) {
      chatOrientationFrom = null;
    }
    const key = ['agent', 'user', 'merged'].flatMap((name) => {
      const layout = presentation[name];
      return [layout.left, layout.top, layout.width, layout.height, layout.style.radius,
        layout.style.opacity, layout.presence, layout.hidden];
    }).map((v) => typeof v === 'number' ? v.toFixed(2) : v).join('|');
    if (key === lastChatKey) return;
    lastChatKey = key;
    if (taskCanvas) taskCanvas.setPresentation(presentation);
    lastChatPresentation = presentation;
  }

  function updateChatLayout() {
    lastChatKey = '';
    applyChatLayout(panel.value);
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
    for (const s of [cam.scale, cam.x, cam.y, panel, drawer, chatOrientation]) { if (!s.settled() && !dragging) s.step(dt); if (!s.settled()) busy = true; }
    if (dragging) busy = true;

    const p = lockscreen || !S.landscape ? 0 : panel.value;
    const tr = L.panelTransforms(p, geom);
    applyPanels(tr, p);
    applyChatLayout(p);
    applyDrawer();

    if (stage.model && stage.app) {
      const show = stageShown();
      if (show !== stage.visible) stage.setVisible(show);
      const ty = transferOffset(now);
      if (S.anim || S.parked) busy = true;
      if (show) {
        const pose = modelPose(tr, ty);
        lipsync.step();
        const interacting = !!dragging || !!S.anim || [cam.scale, cam.x, cam.y, panel, drawer].some((s) => !s.settled());
        const full = !interacting || now - lastFullUpdate >= 90;
        if (full) lastFullUpdate = now;
        stage.render(dt * 1000, pose, full);
        busy = true;
      } else if (S.firstFrame === false) {
        lipsync.step();
      }
      S.firstFrame = false;
    }
    return busy;
  }

  let lastFullUpdate = 0;
  let lastPanelKey = '';
  function applyPanels(tr, p) {
    const key = `${tr.appsX.toFixed(1)}|${tr.widgetsX.toFixed(1)}|${tr.settingsX.toFixed(1)}|${S.landscape}`;
    if (key === lastPanelKey) return;
    lastPanelKey = key;
    const on = S.landscape && !lockscreen;
    el.appsPanel.style.transform = `translate3d(${tr.appsX}px,0,0)`;
    el.widgetsPanel.style.transform = `translate3d(${tr.widgetsX}px,0,0)`;
    el.appsPanel.style.opacity = on ? tr.appsOpacity : 0;
    el.widgetsPanel.style.opacity = on ? tr.widgetsOpacity : 0;
    el.settings.style.transform = `translate3d(${on ? tr.settingsX : 0}px,0,0)`;
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
    const oldView = S.view;
    const oldLandscape = S.landscape;
    const oldChat = lastChatPresentation;
    // Some Android WebViews report stale innerWidth for the first orientation callback. The
    // document viewport already has the committed CSS size and is therefore authoritative.
    const viewport = document.documentElement;
    S.view = { w: viewport.clientWidth || innerWidth, h: viewport.clientHeight || innerHeight };
    const was = S.landscape;
    S.landscape = innerWidth > innerHeight;
    document.body.dataset.landscape = S.landscape ? '1' : '0';
    geom = L.panelGeometry({ viewW: S.view.w, viewH: S.view.h });
    document.documentElement.style.setProperty('--panel-w', `${Math.round(geom.panelW)}px`);
    lastPanelKey = '';
    if (!S.landscape && was) { S.panelState = 0; panel.snap(0); closeSheet(true); }
    if (oldLandscape !== S.landscape && oldChat) {
      chatOrientationFrom = L.remapChatPresentation(oldChat,
        { width: oldView.w, height: oldView.h }, { width: S.view.w, height: S.view.h });
      chatOrientation.snap(0);
      chatOrientation.to(1);
    }
    lastChatKey = '';
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
  const IGNORE = 'button,input,textarea,form,.sheet,.menu,.away-card,.transfer-control,.drawer-list,.widget-card,.toast,.chat-scroll,.tc-bubble,.tc-task';

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
    if (S.hub.state === 'connected') items.push(['叫回电脑', () => transferTo('desktop')]);
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
  const transferPending = () => S.transferRequestPending || !!transferEvents.activeId;

  function renderTransferControl(view) {
    if (lockscreen || !el.transfer) return;
    el.transfer.textContent = view.label;
    el.transfer.disabled = view.disabled;
    el.transfer.dataset.target = view.target || '';
    el.transfer.setAttribute('aria-busy', String(transferPending()));
    el.transferReason.textContent = view.reason || '';
    el.transferReason.title = view.reason || '';
  }

  const transferController = TC.createAndroidTransferController({
    getSnapshot: () => ({ hub: S.hub, deviceId, pending: transferPending() }),
    request: (to) => B.rpc('avatar.transfer', { to }, '', 20000),
    setPending: (pending) => { S.transferRequestPending = pending; },
    onView: renderTransferControl
  });

  function refreshTransferControl() { return transferController.refresh(); }

  async function transferTo(to) {
    const result = await transferController.activate(to);
    if (!result.ok && result.reason) toast(`迁移失败：${result.reason}`);
  }

  function runAnim(kind, id) {
    return new Promise((resolve) => {
      cancelAnim();
      S.anim = { kind, id, t0: performance.now(), done: false, resolve };
      if (kind === 'enter') { S.parked = false; S.exited = false; }
      kick();
    });
  }

  function cancelAnim() {
    const anim = S.anim;
    if (!anim) return null;
    S.anim = null;
    anim.resolve(false);
    return anim.kind;
  }

  function finishAnim(a) {
    if (S.anim !== a) return;
    S.anim = null;
    if (a.kind === 'exit') S.exited = true;
    refreshAway();
    a.resolve(true);
    kick();
  }

  async function onPrepare(d) {
    if (!d || (d.to && d.to !== deviceId)) return;
    const ticket = transferEvents.begin(d.transfer_id);
    refreshTransferControl();
    try { await ensureModel(); } catch { return; }
    if (!transferEvents.isCurrent(ticket)) return;
    S.parked = true;
    S.exited = false;
    refreshAway();
    kick();
    B.publish('avatar.transfer.ready', { transfer_id: d.transfer_id });
  }

  async function onExit(d) {
    if (!d) return;
    const ticket = transferEvents.begin(d.transfer_id);
    refreshTransferControl();
    if (!stage.model) { if (transferEvents.isCurrent(ticket)) B.publish('avatar.transfer.exited', { transfer_id: d.transfer_id }); return; }
    const completed = await runAnim('exit', d.transfer_id);
    if (!completed || !transferEvents.isCurrent(ticket)) return;
    B.publish('avatar.transfer.exited', { transfer_id: d.transfer_id });
  }

  async function onEnter(d) {
    if (!d) return;
    const ticket = transferEvents.begin(d.transfer_id);
    refreshTransferControl();
    try { await ensureModel(); } catch { return; }
    if (!transferEvents.isCurrent(ticket)) return;
    const completed = await runAnim('enter', d.transfer_id);
    if (!completed || !transferEvents.isCurrent(ticket)) return;
    if (actions) actions.act({ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3);
    B.publish('avatar.transfer.entered', { transfer_id: d.transfer_id });
  }

  async function onCancel2(d) {
    if (!transferEvents.clear(d && d.transfer_id)) return;
    const interrupted = cancelAnim();
    S.parked = false;
    refreshTransferControl();
    if (S.exited || interrupted === 'exit') await runAnim('enter', 'cancel');
    refreshAway();
    kick();
  }

  async function recoverOwnedAvatar() {
    if (!isHost()) return;
    cancelAnim();
    S.parked = false;
    S.exited = false;
    try { await ensureModel(); } catch { return; }
    stage.setVisible(true);
    await runAnim('enter', 'owner-recovery');
    refreshAway();
    kick();
  }

  function refreshAway() {
    const away = !lockscreen && (!isHost() || S.exited) && !S.parked && !S.anim;
    el.away.hidden = !away;
    if (away) {
      const title = el.away.querySelector('.away-title');
      if (S.hub.state !== 'connected') {
        title.textContent = '服务器未连接，正在等待角色位置';
        el.awayCall.hidden = true;
      } else if (!S.hub.avatar_host) {
        title.textContent = '正在同步角色位置';
        el.awayCall.hidden = true;
      } else {
        title.textContent = S.hub.avatar_host === 'desktop' ? '八千代在电脑上' : '八千代在另一台设备上';
        el.awayCall.hidden = false;
      }
    }
  }
  el.awayCall.onclick = () => { transferTo(deviceId); };
  el.transfer.onclick = () => {
    const target = el.transfer.dataset.target;
    if (target) transferTo(target);
  };

  /* ------------------------------------------------------------------ hub state */
  function onHubState(st) {
    const next = st || S.hub;
    const owner = ownerTracker.update(next);
    S.hub = { ...next, avatar_host: owner.host };
    el.dot.dataset.state = S.hub.state;
    if (S.hub.state !== 'connected') {
      transferEvents.clear();
      S.transferRequestPending = false;
      cancelAnim();
      S.parked = false;
    }
    if (!isHost()) S.exited = false;
    refreshAway();
    refreshTransferControl();
    kick();
    if (S.hub.state === 'connected') void loadModelCatalog();
  }

  /* ------------------------------------------------------------------ mic / chat */
  let micDownAt = 0;
  let micOn = false;
  function micStart() {
    if (micOn) return;
    micOn = true;
    micDownAt = performance.now();
    el.micBtn.classList.add('rec');
    B.call('micStart', JSON.stringify({
      mode: (cfg.audio || {}).mic_mode || 'push_to_talk',
      model_ref: S.selectedModelRef || undefined,
      audio_mode: audioModeForSelectedModel()
    }));
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

  const openChat = () => { document.body.dataset.chat = '1'; el.chatForm.classList.add('open'); el.chatText.focus(); };
  el.chatBtn.onclick = openChat;
  if (el.activeModelBadge) el.activeModelBadge.onclick = openChat;
  el.chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = el.chatText.value.trim();
    if (!text) return;
    B.publish('chat.input', { text, model_ref: S.selectedModelRef || undefined });
    taskCanvas.showUser(text);
    el.chatText.value = '';
  };
  el.chatText.addEventListener('blur', () => setTimeout(() => {
    if (!el.chatText.value && !el.chatForm.contains(document.activeElement)) {
      el.chatForm.classList.remove('open');
      document.body.dataset.chat = '0';
    }
  }, 150));
  el.chatModel?.addEventListener('change', () => {
    S.selectedModelRef = el.chatModel.value;
    renderModelCatalog();
  });
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

  /* ------------------------------------------------------------------ soft keyboard (B8)
     Native uses adjustNothing: the WebView is never resized, so the stage/canvas stays exactly in place.
     Only the input bar and chat panel follow the keyboard (--ime drives their `bottom`, with a CSS transition). */
  function onIme(d) {
    const css = d && d.visible ? Math.max(0, Math.round(Number(d.height_css) || 0)) : 0;
    S.ime = { visible: css > 0, css };
    document.documentElement.style.setProperty('--ime', `${css}px`);
    document.body.dataset.ime = css > 0 ? '1' : '0';
    updateChatLayout();
    if (!S.ime.visible && document.activeElement === el.chatText) el.chatText.blur(); // keyboard dismissed (e.g. back key)
  }
  B.on('ime', onIme);

  /* ------------------------------------------------------------------ lifecycle */
  B.on('lifecycle', (d) => {
    if (!d) return;
    if (d.state === 'pause' || d.state === 'screen_off') { S.paused = true; if (voice) voice.stop('lifecycle'); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
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
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { setTimeout(onResize, 60); setTimeout(onResize, 240); });
  B.on('config.changed', (c) => {
    const q = quality();
    cfg = c;
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
    refreshTransferControl();

    const taskCanvasApi = window.YachiyoTaskCanvas.createCanvas({ root: el.canvas });
    taskCanvas = taskCanvasApi;
    updateChatLayout();
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
        case 'avatar.transfer.cancel': onCancel2(d); break;
        case 'avatar.host.changed': if (d && d.host) onHubState({ ...S.hub, avatar_host: d.host }); break;
        case 'avatar.transfer.completed': transferEvents.clear(d && d.transfer_id); refreshTransferControl(); break;
        case 'avatar.transfer.failed': onCancel2(d).then(() => recoverOwnedAvatar()); toast(`迁移失败：${(d && d.reason) || ''}`); break;
        default:
      }
    });
    B.subscribe('sys.device.*', () => {});

    if (!lockscreen) {
      plugins = window.YachiyoPluginHost.create({
        bridge: B, geom, getTheme: () => ({ mode: 'dark', accent: '#b6a1ff' }), toast,
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
    if (S.hub.state === 'connected') void loadModelCatalog();
    if (qs.get('debug') === '1') { const s = document.createElement('script'); s.src = 'js/debug.js'; document.body.appendChild(s); }

    // Let the hub settle before deciding who shows the character (avoids a flash on non-host devices).
    const wantHub = (cfg.server || {}).auto_connect && S.hub.state !== 'connected';
    if (wantHub) await new Promise((r) => { const off = B.on('hub.state', (s) => { if (s && s.state !== 'connecting') { off(); r(); } }); setTimeout(r, 1800); });
    onHubState(B.hubState());

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
    onPrepare, onExit, onEnter, onCancel: onCancel2, onHubState, onIme
  };

  boot();
})();
