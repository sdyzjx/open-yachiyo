// config-v2-models.js — "models" tab for Config v2 (contract C4.4 HTTP API).
// All dynamic text is inserted via textContent (no innerHTML) so config values cannot inject markup.
(function () {
  const ROLES = ['chat', 'vision', 'summary'];
  const pane = document.getElementById('cv2-models-pane');
  if (!pane) return;

  let state = null; // GET /api/config/models data
  let presets = [];
  let editing = null; // { key, isNew }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
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

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data;
  }

  function setStatus(text, isErr) {
    const status = document.getElementById('cv2-models-status');
    if (!status) return;
    status.textContent = text || '';
    status.className = `status ${isErr ? 'err' : 'ok'}`;
  }

  function modelOptions(selectedRef, { allowEmpty, emptyLabel } = {}) {
    const opts = [];
    if (allowEmpty) opts.push(h('option', { value: '', text: emptyLabel || '(默认)' }));
    for (const m of state.models) {
      const o = h('option', { value: m.ref, text: `${m.ref}${m.name && m.name !== m.id ? ` — ${m.name}` : ''}` });
      if (m.ref === selectedRef) o.selected = true;
      opts.push(o);
    }
    return opts;
  }

  // ---------- selection section ----------
  const draft = { active: null, enabled: new Set(), roles: {}, fallback: [] };

  function resetDraft() {
    draft.active = state.active;
    draft.enabled = new Set(state.enabled);
    draft.roles = { ...state.roles };
    draft.fallback = [...state.fallback_models];
  }

  function renderSelection(root) {
    const byProvider = new Map();
    for (const m of state.models) {
      if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
      byProvider.get(m.provider).push(m);
    }
    const list = h('div', { class: 'cv2m-model-list' });
    for (const [provider, models] of byProvider) {
      list.append(h('div', { class: 'cv2m-provider-label', text: state.providers[provider]?.display_name || provider }));
      for (const m of models) {
        list.append(h('div', { class: 'cv2m-model-row' },
          h('label', { class: 'cv2m-check' },
            h('input', {
              type: 'checkbox', checked: draft.enabled.has(m.ref),
              onchange: (e) => { if (e.target.checked) draft.enabled.add(m.ref); else draft.enabled.delete(m.ref); }
            }),
            h('span', { text: ' 启用' })),
          h('label', { class: 'cv2m-check' },
            h('input', {
              type: 'radio', name: 'cv2m-active', checked: draft.active === m.ref,
              onchange: () => { draft.active = m.ref; draft.enabled.add(m.ref); renderAll(); }
            }),
            h('span', { text: ' 当前' })),
          h('span', { class: 'cv2m-model-name', text: m.name || m.id }),
          h('code', { class: 'cv2m-ref', text: m.ref }),
          m.reasoning ? h('span', { class: 'cv2m-tag', text: 'reasoning' }) : null,
          (m.input || []).includes('image') ? h('span', { class: 'cv2m-tag', text: 'vision' }) : null,
          !m.has_api_key ? h('span', { class: 'cv2m-tag cv2m-tag-warn', text: '无密钥' }) : null));
      }
    }

    const roles = h('div', { class: 'cv2m-roles' },
      ROLES.map((role) => h('label', { class: 'cv2m-field' },
        h('span', { text: role }),
        h('select', {
          onchange: (e) => { if (e.target.value) draft.roles[role] = e.target.value; else delete draft.roles[role]; }
        }, modelOptions(draft.roles[role], { allowEmpty: true, emptyLabel: '(使用当前模型)' })))));

    const fallbackBox = h('div', { class: 'cv2m-fallback' });
    draft.fallback.forEach((ref, i) => {
      fallbackBox.append(h('div', { class: 'cv2m-fallback-row' },
        h('span', { text: `${i + 1}.` }),
        h('select', { onchange: (e) => { draft.fallback[i] = e.target.value; } }, modelOptions(ref)),
        h('button', { class: 'btn', type: 'button', text: '移除', onclick: () => { draft.fallback.splice(i, 1); renderAll(); } })));
    });
    fallbackBox.append(h('button', {
      class: 'btn', type: 'button', text: '+ 添加回退模型',
      onclick: () => { if (state.models[0]) { draft.fallback.push(state.models[0].ref); renderAll(); } }
    }));

    root.append(
      h('h2', { class: 'cv2m-h', text: '模型选择' }),
      h('p', { class: 'cv2m-hint', text: '勾选需要出现在切换器中的模型，选择当前使用的模型；主模型遇到网络错误 / 429 / 5xx 时按顺序尝试回退模型。' }),
      list,
      h('h3', { class: 'cv2m-h3', text: '按用途分配' }), roles,
      h('h3', { class: 'cv2m-h3', text: '回退链' }), fallbackBox,
      h('div', { class: 'cv2m-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', text: '保存选择', onclick: saveSelection }),
        h('button', { class: 'btn', type: 'button', text: '还原', onclick: () => { resetDraft(); renderAll(); } })));
  }

  async function saveSelection() {
    try {
      setStatus('保存中…');
      const enabled = state.models.map((m) => m.ref).filter((r) => draft.enabled.has(r));
      state = await api('PUT', '/api/config/models/selection', {
        active_model: draft.active,
        enabled_models: enabled,
        roles: draft.roles,
        fallback_models: draft.fallback.filter(Boolean)
      });
      resetDraft();
      renderAll();
      setStatus('已保存 ✓');
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  // ---------- providers section ----------
  function renderProviders(root) {
    const rows = Object.values(state.providers).map((p) => h('div', { class: 'cv2m-provider-row' },
      h('strong', { text: p.display_name }),
      h('code', { text: p.key }),
      h('span', { class: 'cv2m-muted', text: `${p.type} · ${p.base_url || ''}` }),
      p.requires_api_key && !p.has_api_key ? h('span', { class: 'cv2m-tag cv2m-tag-warn', text: '无密钥' }) : null,
      h('button', { class: 'btn', type: 'button', text: '编辑', onclick: () => { editing = { key: p.key, isNew: false }; renderAll(); } })));

    const presetSelect = h('select', { id: 'cv2m-new-preset' },
      presets.map((p) => h('option', { value: p.id, text: p.name })));
    root.append(
      h('h2', { class: 'cv2m-h', text: 'Provider' }),
      h('div', { class: 'cv2m-provider-list' }, rows),
      h('div', { class: 'cv2m-actions' },
        h('label', { class: 'cv2m-field' }, h('span', { text: '从预设添加' }), presetSelect),
        h('button', {
          class: 'btn', type: 'button', text: '+ 添加',
          onclick: () => {
            const preset = presets.find((p) => p.id === presetSelect.value);
            editing = { key: preset.id === 'custom' ? '' : preset.id, isNew: true, preset };
            renderAll();
          }
        })));
  }

  function jsonField(label, id, value) {
    return h('label', { class: 'cv2m-field cv2m-wide' }, h('span', { text: label }),
      h('textarea', { id, rows: 3, spellcheck: false, text: JSON.stringify(value || {}, null, 2) }));
  }

  function modelsToText(models) {
    return (models || []).map((m) => (m.name && m.name !== m.id ? `${m.id} | ${m.name}` : m.id)).join('\n');
  }

  function textToModels(text, previous) {
    const prev = new Map((previous || []).map((m) => [m.id, m]));
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [id, name] = line.split('|').map((s) => s.trim());
      return { ...(prev.get(id) || {}), id, ...(name ? { name } : {}) };
    });
  }

  function renderEditor(root) {
    const existing = state.providers[editing.key] || null;
    const base = existing || (editing.preset ? {
      key: editing.key, type: editing.preset.type, preset: editing.preset.id === 'custom' ? null : editing.preset.id,
      display_name: editing.preset.name, base_url: editing.preset.base_url, api_key_env: editing.preset.api_key_env,
      has_api_key: false, requires_api_key: editing.preset.requires_api_key,
      timeout_ms: 60000, headers: {}, compat: editing.preset.compat, extra_body: {}, models: editing.preset.models
    } : {});
    const val = (id) => document.getElementById(id).value;
    const inputField = (label, id, value, type) => h('label', { class: 'cv2m-field' }, h('span', { text: label }),
      h('input', { id, type: type || 'text', value: value ?? '', autocomplete: 'off', spellcheck: false }));

    const typeSelect = h('select', { id: 'cv2m-type' },
      ['openai_compatible', 'anthropic', 'google'].map((t) => {
        const o = h('option', { value: t, text: t }); if (t === base.type) o.selected = true; return o;
      }));

    function collectDraft() {
      const parse = (id, label) => {
        try { return JSON.parse(val(id) || '{}'); } catch { throw new Error(`${label} 不是合法 JSON`); }
      };
      const out = {
        type: val('cv2m-type'),
        display_name: val('cv2m-display') || undefined,
        base_url: val('cv2m-base'),
        api_key_env: val('cv2m-env') || undefined,
        timeout_ms: Number(val('cv2m-timeout')) || undefined,
        headers: parse('cv2m-headers', 'headers'),
        compat: parse('cv2m-compat', 'compat'),
        extra_body: parse('cv2m-extra', 'extra_body'),
        models: textToModels(val('cv2m-models'), base.models)
      };
      if (base.preset) out.preset = base.preset;
      const key = val('cv2m-apikey');
      if (key) out.api_key = key;
      if (base.requires_api_key === false) out.requires_api_key = false;
      return out;
    }

    const result = h('div', { id: 'cv2m-edit-result', class: 'cv2m-result', role: 'status' });
    const showResult = (text, isErr) => { result.textContent = text; result.className = `cv2m-result ${isErr ? 'err' : 'ok'}`; };

    root.append(h('div', { class: 'cv2m-editor panel' },
      h('h2', { class: 'cv2m-h', text: editing.isNew ? '添加 provider' : `编辑 provider: ${editing.key}` }),
      h('div', { class: 'cv2m-grid' },
        inputField('Key（唯一标识）', 'cv2m-key', editing.key),
        inputField('显示名', 'cv2m-display', base.display_name),
        h('label', { class: 'cv2m-field' }, h('span', { text: '类型' }), typeSelect),
        inputField('Base URL', 'cv2m-base', base.base_url),
        inputField(`API Key${base.has_api_key ? '（已设置，留空保持不变）' : ''}`, 'cv2m-apikey', '', 'password'),
        inputField('API Key 环境变量', 'cv2m-env', base.api_key_env),
        inputField('超时 ms', 'cv2m-timeout', base.timeout_ms, 'number'),
        h('label', { class: 'cv2m-field cv2m-wide' }, h('span', { text: '模型（每行一个：id 或 id | 名称）' }),
          h('textarea', { id: 'cv2m-models', rows: 5, spellcheck: false, text: modelsToText(base.models) })),
        jsonField('额外请求头 headers (JSON)', 'cv2m-headers', base.headers),
        jsonField('兼容项 compat (JSON)', 'cv2m-compat', base.compat),
        jsonField('额外请求体 extra_body (JSON)', 'cv2m-extra', base.extra_body)),
      h('div', { class: 'cv2m-actions' },
        h('button', {
          class: 'btn', type: 'button', text: '发现模型',
          onclick: async () => {
            try {
              showResult('发现中…');
              const data = await api('POST', '/api/config/models/discover', { provider: collectDraft(), provider_key: existing ? editing.key : undefined });
              if (!data.ok) return showResult(`失败: ${data.error}`, true);
              const area = document.getElementById('cv2m-models');
              const have = new Set(textToModels(area.value).map((m) => m.id));
              const extra = data.models.map((m) => m.id).filter((id) => !have.has(id));
              area.value = [area.value.trim(), ...extra].filter(Boolean).join('\n');
              showResult(`发现 ${data.models.length} 个模型，新增 ${extra.length} 个到列表`);
            } catch (err) { showResult(err.message, true); }
          }
        }),
        h('button', {
          class: 'btn', type: 'button', text: '测试连接',
          onclick: async () => {
            try {
              showResult('测试中…');
              const data = await api('POST', '/api/config/models/test', { provider: collectDraft(), provider_key: existing ? editing.key : undefined });
              showResult(data.ok ? `连接成功，${data.latency_ms} ms` : `失败 (${data.status ?? 'n/a'}): ${data.error}`, !data.ok);
            } catch (err) { showResult(err.message, true); }
          }
        }),
        h('button', {
          class: 'btn btn-primary', type: 'button', text: '保存 provider',
          onclick: async () => {
            try {
              const key = val('cv2m-key').trim();
              if (!key) throw new Error('Key 不能为空');
              state = await api('PUT', `/api/config/models/providers/${encodeURIComponent(key)}`, collectDraft());
              editing = null;
              resetDraft();
              renderAll();
              setStatus('provider 已保存 ✓');
            } catch (err) { showResult(err.message, true); }
          }
        }),
        !editing.isNew ? h('button', {
          class: 'btn', type: 'button', text: '删除',
          onclick: async () => {
            if (!window.confirm(`删除 provider ${editing.key}？`)) return;
            try {
              state = await api('DELETE', `/api/config/models/providers/${encodeURIComponent(editing.key)}`);
              editing = null; resetDraft(); renderAll(); setStatus('已删除 ✓');
            } catch (err) { showResult(err.message, true); }
          }
        }) : null,
        h('button', { class: 'btn', type: 'button', text: '取消', onclick: () => { editing = null; renderAll(); } })),
      result));
    if (!editing.isNew) document.getElementById('cv2m-key').readOnly = true;
  }

  function renderAll() {
    pane.replaceChildren();
    const head = h('div', { class: 'cv2m-head' },
      h('span', { class: 'cv2-file-label', text: '模型配置 (providers.yaml v2)' }),
      h('span', { id: 'cv2-models-status', class: 'status', role: 'status', 'aria-live': 'polite' }),
      h('button', { class: 'btn', type: 'button', text: '重新加载', onclick: load }));
    const body = h('div', { class: 'cv2m-body' });
    pane.append(head, body);
    renderSelection(body);
    renderProviders(body);
    if (editing) renderEditor(body);
  }

  async function load() {
    try {
      [state, presets] = await Promise.all([api('GET', '/api/config/models'), api('GET', '/api/config/models/presets')]);
      resetDraft();
      renderAll();
      setStatus('已加载');
    } catch (err) {
      pane.replaceChildren(h('p', { class: 'status err', text: err.message }));
    }
  }

  window.CV2Models = { show: load };
})();
