/*
 * Plugin host (task 8): app grid / widget grid, sandboxed iframes, postMessage broker (contract C3).
 * Permission decisions live in pluginProtocol.js (unit tested); this file wires them to the bridge and DOM.
 */
(function (global) {
  'use strict';

  const P = global.YachiyoPluginProtocol;
  const G = global.YachiyoPluginGrid;
  const SANDBOX = 'allow-scripts allow-forms allow-pointer-lock';
  const GAP = 8;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function create({ bridge, geom, getTheme, toast, els, getConfig, onSheet, onEditing, actions, openApp: revealApps }) {
    let list = [];                       // enabled, valid manifests with base_url
    const frames = new Map();            // plugin id -> frame record
    const byWindow = new Map();          // contentWindow -> record
    let layout = [];
    let cell = 70;
    let activeApp = null;
    let editing = false;
    let curGeom = geom;
    let seq = 0;
    const revision = P.manifestRevision;

    /* ---------------------------------------------------------- messaging */
    function post(rec, msg) {
      try { rec.iframe.contentWindow.postMessage({ __yachiyo: 1, ...msg }, '*'); } catch { /* frame gone */ }
    }
    const reply = (rec, req, result) => post(rec, { kind: 'res', id: req.id, op: req.op, payload: { ok: true, result } });
    const fail = (rec, req, code, message) => post(rec, { kind: 'res', id: req.id, op: req.op, payload: { error: { code, message } } });

    function widgetSize(rec) {
      const m = rec.manifest;
      if (m.type !== 'widget') return null;
      const e = layout.find((l) => l.id === m.id);
      const w = e ? e.w : G.sizeFor(m).w; const h = e ? e.h : G.sizeFor(m).h;
      return { w, h, widthPx: Math.round(w * cell + (w - 1) * GAP), heightPx: Math.round(h * cell + (h - 1) * GAP) };
    }

    function invokeInPlugin(rec, name, params) {
      return new Promise((resolve, reject) => {
        const id = `h${++seq}`;
        const timer = setTimeout(() => { rec.pending.delete(id); reject(Object.assign(new Error('plugin method timeout'), { code: -32003 })); }, 7000);
        rec.pending.set(id, { resolve, reject, timer });
        post(rec, { kind: 'req', id, op: 'rpc.invoke', payload: { name, params } });
      });
    }

    async function handleRequest(rec, msg) {
      const m = rec.manifest;
      const chk = P.checkOp(m, msg.op, msg.payload, { lockscreen: false });
      if (!chk.ok) { fail(rec, msg, chk.code, chk.message); return; }
      const p = chk.payload;
      try {
        switch (msg.op) {
          case 'ready':
            reply(rec, msg, { pluginId: m.id, type: m.type, theme: getTheme(), locale: navigator.language || 'zh-CN', widget: widgetSize(rec) });
            return;
          case 'bus.publish':
            bridge.publish(p.topic, p.data);
            reply(rec, msg, true);
            return;
          case 'bus.subscribe': {
            const subId = String(p.sub_id || `s${++seq}`);
            if (rec.subs.has(subId)) rec.subs.get(subId)();
            rec.subs.set(subId, bridge.subscribe(p.pattern, (data, ev) => post(rec, { kind: 'event', op: 'bus.event', payload: { sub_id: subId, topic: ev.topic, data, from: ev.from } })));
            reply(rec, msg, { sub_id: subId });
            return;
          }
          case 'bus.unsubscribe': {
            const off = rec.subs.get(String((msg.payload || {}).sub_id));
            if (off) { off(); rec.subs.delete(String(msg.payload.sub_id)); }
            reply(rec, msg, true);
            return;
          }
          case 'rpc.call':
            reply(rec, msg, await bridge.rpc(p.method, p.params, p.target));
            return;
          case 'rpc.register': {
            const previous = rec.rpcOffs.get(p.name);
            if (previous) previous();
            rec.methods.add(p.name);
            rec.rpcOffs.set(p.name, bridge.handleRpc(p.full_name, (params) => invokeInPlugin(rec, p.name, params)));
            bridge.register([{ name: p.full_name, description: p.description, params_schema: p.params_schema, expose_as_tool: p.expose_as_tool, scope: 'plugin' }]);
            reply(rec, msg, { name: p.full_name });
            return;
          }
          case 'rpc.unregister': {
            const off = rec.rpcOffs.get(p.name);
            if (off) off();
            rec.rpcOffs.delete(p.name);
            rec.methods.delete(p.name);
            bridge.unregister([p.full_name]);
            reply(rec, msg, true);
            return;
          }
          case 'storage.get': {
            const raw = bridge.call('pluginStorageGet', m.id, p.key);
            let v = null;
            if (raw) { try { v = JSON.parse(raw); } catch { v = null; } }
            reply(rec, msg, v);
            return;
          }
          case 'storage.set':
            bridge.call('pluginStorageSet', m.id, p.key, JSON.stringify(p.value));
            reply(rec, msg, true);
            return;
          case 'avatar.act': {
            const a = actions();
            const body = { action: p.action, duration_sec: p.duration_sec || 2, queue_policy: p.queue_policy || 'append' };
            if (a) reply(rec, msg, a.enqueue(body));
            else reply(rec, msg, await bridge.rpc('live2d.action.enqueue', body));
            return;
          }
          case 'ui.close':
            if (m.type === 'app') closeApp();
            reply(rec, msg, true);
            return;
          case 'ui.setTitle':
            if (activeApp === m.id) els.sheetTitle.textContent = p.title;
            reply(rec, msg, true);
            return;
          default:
            fail(rec, msg, -32601, `unhandled op ${msg.op}`);
        }
      } catch (err) {
        fail(rec, msg, err && err.code ? err.code : -32000, (err && err.message) || 'error');
      }
    }

    global.addEventListener('message', (e) => {
      const rec = byWindow.get(e.source);
      if (!rec || !P.isEnvelope(e.data)) return;
      const msg = e.data;
      if (msg.kind === 'req') { handleRequest(rec, msg); return; }
      if (msg.kind === 'res') {
        const pend = rec.pending.get(msg.id);
        if (!pend) return;
        rec.pending.delete(msg.id);
        clearTimeout(pend.timer);
        const pl = msg.payload || {};
        if (pl.error) pend.reject(Object.assign(new Error(pl.error.message || 'plugin error'), { code: pl.error.code || -32000 }));
        else pend.resolve(pl.result);
      }
    });

    /* ---------------------------------------------------------- frames */
    function makeFrame(manifest, parent) {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', SANDBOX);
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.title = manifest.name;
      const rec = { manifest, revision: revision(manifest), iframe, subs: new Map(), methods: new Set(), rpcOffs: new Map(), pending: new Map() };
      parent.appendChild(iframe);
      iframe.src = `${manifest.base_url}${manifest.entry || 'index.html'}`;
      byWindow.set(iframe.contentWindow, rec);
      frames.set(manifest.id, rec);
      return rec;
    }

    function destroyFrame(rec) {
      for (const off of rec.subs.values()) off();
      for (const off of rec.rpcOffs.values()) off();
      if (rec.methods.size) bridge.unregister(Array.from(rec.methods).map((n) => P.methodName(rec.manifest.id, n)));
      for (const pend of rec.pending.values()) { clearTimeout(pend.timer); pend.reject(new Error('plugin unloaded')); }
      byWindow.delete(rec.iframe.contentWindow);
      frames.delete(rec.manifest.id);
      if (rec.card) rec.card.remove(); else rec.iframe.remove();
    }

    /* ---------------------------------------------------------- apps */
    const wantsBackground = (m) => m.background === true || P.parsePermissions(m).register;

    function ensureAppFrame(m) {
      let rec = frames.get(m.id);
      if (!rec) { rec = makeFrame(m, els.sheetBody); rec.iframe.style.visibility = 'hidden'; }
      return rec;
    }

    function renderApps() {
      const apps = list.filter((m) => m.type === 'app');
      const order = (getConfig().plugins || {}).app_order || [];
      apps.sort((a, b) => {
        const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name, 'zh');
      });
      els.appsEmpty.hidden = apps.length > 0;
      els.appsGrid.replaceChildren(...apps.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'app-item';
        const icon = document.createElement('div');
        icon.className = 'app-icon';
        if (m.icon) { const img = document.createElement('img'); img.alt = ''; img.src = `${m.base_url}${m.icon}`; img.onerror = () => { img.remove(); icon.textContent = m.name.slice(0, 1); }; icon.appendChild(img); } else icon.textContent = m.name.slice(0, 1);
        const label = document.createElement('div');
        label.className = 'app-label';
        label.textContent = m.name;
        b.append(icon, label);
        b.onclick = () => openApp(m.id);
        return b;
      }));
    }

    function openApp(id) {
      const m = list.find((x) => x.id === id && x.type === 'app');
      if (!m) return;
      const rec = ensureAppFrame(m);
      for (const r of frames.values()) { if (r.manifest.type === 'app') r.iframe.style.visibility = r === rec ? 'visible' : 'hidden'; }
      activeApp = id;
      els.sheetTitle.textContent = m.name;
      els.sheet.classList.add('open');
      els.sheet.classList.remove('full');
      els.sheetExpand.textContent = '全屏';
      onSheet(true);
    }

    function closeApp(immediate) {
      if (!els.sheet.classList.contains('open')) return;
      if (immediate) els.sheet.style.transition = 'none';
      els.sheet.classList.remove('open', 'full');
      if (immediate) requestAnimationFrame(() => { els.sheet.style.transition = ''; });
      activeApp = null;
      onSheet(false);
    }

    els.sheetClose.onclick = () => closeApp();
    els.sheetExpand.onclick = () => {
      const full = els.sheet.classList.toggle('full');
      els.sheetExpand.textContent = full ? '还原' : '全屏';
    };

    /* ---------------------------------------------------------- widgets */
    function geometry() {
      const gridW = Math.max(120, curGeom.panelW - 28 - 2);
      cell = Math.floor((gridW - GAP * (G.COLS - 1)) / G.COLS);
      els.widgetsGrid.style.setProperty('--cell', `${cell}px`);
      return gridW;
    }

    function placeCard(rec, entry) {
      const c = rec.card;
      c.style.left = `${entry.x * (cell + GAP)}px`;
      c.style.top = `${entry.y * (cell + GAP)}px`;
      c.style.width = `${entry.w * cell + (entry.w - 1) * GAP}px`;
      c.style.height = `${entry.h * cell + (entry.h - 1) * GAP}px`;
    }

    function layoutWidgets(notify) {
      geometry();
      for (const entry of layout) {
        const rec = frames.get(entry.id);
        if (!rec || !rec.card) continue;
        placeCard(rec, entry);
        if (notify) { const s = widgetSize(rec); post(rec, { kind: 'event', op: 'widget.resize', payload: s }); }
      }
      const rows = G.rowsUsed(layout);
      els.widgetsGrid.style.height = `${Math.max(0, rows * (cell + GAP) - GAP)}px`;
    }

    function saveLayout() {
      const plugins = { ...(getConfig().plugins || {}), widget_layout: layout.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) };
      bridge.setConfig({ plugins });
    }

    function renderWidgets() {
      const widgets = list.filter((m) => m.type === 'widget');
      layout = G.normalizeLayout((getConfig().plugins || {}).widget_layout, widgets);
      els.widgetsEmpty.hidden = widgets.length > 0;
      for (const m of widgets) {
        let rec = frames.get(m.id);
        if (!rec) {
          const card = document.createElement('div');
          card.className = 'widget-card';
          const shield = document.createElement('div');
          shield.className = 'widget-shield';
          card.appendChild(shield);
          els.widgetsGrid.appendChild(card);
          rec = makeFrame(m, card);
          rec.card = card;
          rec.shield = shield;
          card.dataset.id = m.id;
          bindDrag(rec);
        }
      }
      layoutWidgets(true);
    }

    function setEditing(v) {
      editing = !!v;
      els.widgetsGrid.classList.toggle('editing', editing);
      els.widgetsEdit.textContent = editing ? '完成' : '编辑';
      if (!editing) saveLayout();
      onEditing(editing);
    }
    els.widgetsEdit.onclick = () => setEditing(!editing);

    function bindDrag(rec) {
      let start = null;
      rec.shield.addEventListener('pointerdown', (e) => {
        if (!editing) return;
        e.preventDefault();
        rec.shield.setPointerCapture(e.pointerId);
        const entry = layout.find((l) => l.id === rec.manifest.id);
        const rect = rec.card.getBoundingClientRect();
        start = { px: e.clientX, py: e.clientY, left: rect.left, top: rect.top, entry: { ...entry } };
        rec.card.classList.add('dragging');
      });
      rec.shield.addEventListener('pointermove', (e) => {
        if (!start) return;
        const gridRect = els.widgetsGrid.getBoundingClientRect();
        const left = start.left + (e.clientX - start.px) - gridRect.left;
        const top = start.top + (e.clientY - start.py) - gridRect.top;
        rec.card.style.left = `${left}px`;
        rec.card.style.top = `${top}px`;
        const gx = clamp(Math.round(left / (cell + GAP)), 0, G.COLS - start.entry.w);
        const gy = Math.max(0, Math.round(top / (cell + GAP)));
        const cur = layout.find((l) => l.id === rec.manifest.id);
        if (cur.x !== gx || cur.y !== gy) {
          layout = G.moveItem(layout, rec.manifest.id, gx, gy);
          for (const entry of layout) { const r = frames.get(entry.id); if (r && r !== rec) placeCard(r, entry); }
          els.widgetsGrid.style.height = `${G.rowsUsed(layout) * (cell + GAP) - GAP}px`;
        }
      });
      const end = () => {
        if (!start) return;
        start = null;
        rec.card.classList.remove('dragging');
        placeCard(rec, layout.find((l) => l.id === rec.manifest.id));
        saveLayout();
      };
      rec.shield.addEventListener('pointerup', end);
      rec.shield.addEventListener('pointercancel', end);
    }

    /* ---------------------------------------------------------- refresh */
    function refresh() {
      const raw = bridge.json('listPlugins', []);
      const next = [];
      for (const m of raw) {
        const errors = P.validateManifest(m);
        if (errors.length) { bridge.log('warn', `plugin ${m && m.id} invalid: ${errors.join('; ')}`); continue; }
        if (m.enabled === false) continue;
        next.push(m);
      }
      const keep = new Map(next.map((m) => [m.id, revision(m)]));
      for (const rec of Array.from(frames.values())) {
        if (keep.get(rec.manifest.id) !== rec.revision) {
          if (activeApp === rec.manifest.id) closeApp(true);
          destroyFrame(rec);
        }
      }
      list = next;
      renderApps();
      renderWidgets();
      for (const m of list) { if (m.type === 'app' && wantsBackground(m)) ensureAppFrame(m); }
    }

    function relayout(g) { curGeom = g; layoutWidgets(true); }

    function broadcastTheme() { for (const rec of frames.values()) post(rec, { kind: 'event', op: 'theme.changed', payload: getTheme() }); }

    return { refresh, relayout, openApp, closeApp, setEditing, broadcastTheme, get frames() { return frames; }, get activeApp() { return activeApp; } };
  }

  global.YachiyoPluginHost = { create };
})(window);
