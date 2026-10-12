// config-v2-core.js — shared helpers for the settings WebUI.
// All dynamic text goes through textContent (no innerHTML), so config values cannot inject markup.
(function () {
  const pages = new Map();
  let toastTimer = null;

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = Boolean(v);
      else if (k === 'selected') node.selected = Boolean(v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Calls the gateway JSON APIs. Resolves with `data` (or the full body when no `data`).
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    if (res.status === 403) throw new Error('仅本机可访问配置接口（请在电脑本机打开此页）');
    if (!json || json.ok === false) throw new Error((json && json.error) || `请求失败 (HTTP ${res.status})`);
    return json.data !== undefined ? json.data : json;
  }

  function toast(text, isErr) {
    const node = document.getElementById('cv-toast');
    if (!node) return;
    node.textContent = text;
    node.className = `cv-toast${isErr ? ' is-err' : ''}`;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, isErr ? 6000 : 2800);
  }

  function chip(text, tone) {
    return h('span', { class: `y-chip${tone ? ` cv-chip--${tone}` : ''}`, text });
  }

  function field(label, control, hint, wide) {
    return h('label', { class: `cv-field${wide ? ' cv-wide' : ''}` },
      h('span', { class: 'cv-label', text: label }), control,
      hint ? h('span', { class: 'cv-hint', text: hint }) : null);
  }

  function card(title, ...children) {
    return h('section', { class: 'cv-card y-glass' },
      title ? h('h2', { class: 'cv-card-title', text: title }) : null, ...children);
  }

  function register(id, page) { pages.set(id, page); }
  function getPage(id) { return pages.get(id); }

  window.CV2 = { h, api, toast, chip, field, card, register, getPage };
})();
