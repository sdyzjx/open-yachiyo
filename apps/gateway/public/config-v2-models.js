// config-v2-models.js — 「模型与路由」页 (contract C4.4 HTTP API).
(function () {
  const { h, api, toast, chip, field, card, register } = window.CV2;
  const CHAT_TYPES = ['openai_compatible', 'anthropic', 'google'];
  const ROLES = [['chat', '对话'], ['vision', '看图'], ['summary', '摘要']];

  let state = null;
  let presets = [];
  let editing = null; // { key, isNew, preset }
  const draft = { active: null, enabled: new Set(), roles: {}, fallback: [] };
  let rerender = () => {};

  const chatProviders = () => Object.values(state.providers).filter((p) => CHAT_TYPES.includes(p.type));

  function resetDraft() {
    draft.active = state.active;
    draft.enabled = new Set(state.enabled);
    draft.roles = { ...state.roles };
    draft.fallback = [...state.fallback_models];
  }

  function modelOptions(selected, emptyLabel) {
    const opts = [];
    if (emptyLabel) opts.push(h('option', { value: '', text: emptyLabel }));
    for (const m of state.models) {
      opts.push(h('option', { value: m.ref, selected: m.ref === selected, text: m.ref }));
    }
    return opts;
  }

  // ---- providers ----
  function renderProviders() {
    const list = chatProviders().map((p) => h('div', { class: 'cv-row' },
      h('div', { class: 'cv-row-main' },
        h('strong', { text: p.display_name }),
        h('span', { class: 'cv-mono cv-dim', text: p.key })),
      h('div', { class: 'cv-row-meta' },
        chip(p.type),
        p.requires_api_key
          ? (p.has_api_key ? chip('密钥已设置', 'good') : chip('缺少密钥', 'warn'))
          : chip('无需密钥'),
        h('span', { class: 'cv-dim cv-ellipsis', title: p.base_url || '', text: p.base_url || '' })),
      h('button', { class: 'y-btn', type: 'button', text: '编辑', onclick: () => { editing = { key: p.key, isNew: false }; rerender(); } })));

    const presetSelect = h('select', { class: 'y-input', id: 'cv-new-preset', 'aria-label': '预设' },
      presets.map((p) => h('option', { value: p.id, text: p.name })));
    return card('服务商',
      h('p', { class: 'cv-hint', text: '服务商是一个 API 接入点（Base URL + 密钥）。DeepSeek、通义千问、OpenRouter 等兼容 OpenAI 的服务通过预设添加。API Key 只写不读，保存后不会回显。' }),
      list.length ? h('div', { class: 'cv-list' }, list) : h('p', { class: 'cv-hint', text: '尚未配置任何对话服务商。' }),
      h('div', { class: 'cv-actions' },
        presetSelect,
        h('button', {
          class: 'y-btn', type: 'button', text: '添加服务商',
          onclick: () => {
            const preset = presets.find((p) => p.id === presetSelect.value);
            editing = { key: preset.id === 'custom' ? '' : preset.id, isNew: true, preset };
            rerender();
          }
        })));
  }

  function modelsToText(models) {
    return (models || []).map((m) => [
      m.id,
      m.name && m.name !== m.id ? m.name : '',
      Array.isArray(m.input) ? m.input.join(',') : '',
      Array.isArray(m.output) ? m.output.join(',') : '',
      m.transport || 'request',
      m.audio?.mode || ''
    ].join(' | ').replace(/(?:\s*\|\s*)+$/, '')).join('\n');
  }
  function textToModels(text, previous) {
    const prev = new Map((previous || []).map((m) => [m.id, m]));
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((s) => s.trim());
      const [id, name, inputText] = parts;
      const legacy = parts.length <= 4;
      const outputText = legacy ? '' : parts[3];
      const transport = legacy ? parts[3] : parts[4];
      const audioMode = legacy ? '' : parts[5];
      const input = inputText ? inputText.split(',').map((item) => item.trim()).filter(Boolean) : null;
      const output = outputText ? outputText.split(',').map((item) => item.trim()).filter(Boolean) : null;
      const prior = prev.get(id) || {};
      const next = {
        ...prior,
        id,
        ...(name ? { name } : {}),
        input: input || prior.input || ['text'],
        output: output || prior.output || ['text'],
        transport: transport || prior.transport || 'request'
      };
      if (audioMode === 'direct') next.audio = { mode: 'direct', input_format: 'wav' };
      if (audioMode === 'realtime') next.audio = {
        mode: 'realtime', input_format: 'pcm_s16le', input_sample_rate: 16000,
        output_format: 'pcm_s16le', output_sample_rate: 24000
      };
      if (!legacy && !audioMode) delete next.audio;
      return next;
    });
  }
  window.CV2.modelCodec = { modelsToText, textToModels };

  function renderEditor() {
    const existing = state.providers[editing.key] || null;
    const pr = editing.preset;
    const base = existing || (pr ? {
      type: pr.type, preset: pr.id === 'custom' ? null : pr.id, display_name: pr.name, base_url: pr.base_url,
      api_key_env: pr.api_key_env, has_api_key: false, requires_api_key: pr.requires_api_key,
      timeout_ms: 60000, models: pr.models
    } : { type: 'openai_compatible', models: [] });
    const ids = {};
    const input = (name, value, type, extra) => {
      const node = h('input', { class: 'y-input', type: type || 'text', value: value ?? '', autocomplete: 'off', spellcheck: false, ...extra });
      ids[name] = node;
      return node;
    };
    const typeSelect = h('select', { class: 'y-input' }, CHAT_TYPES.map((t) => h('option', { value: t, selected: t === base.type, text: t })));
    ids.type = typeSelect;
    const modelsArea = h('textarea', { class: 'y-input cv-mono', rows: 5, spellcheck: false, value: modelsToText(base.models) });
    const clearKey = h('input', { type: 'checkbox' });
    const result = h('div', { class: 'cv-result', role: 'status' });
    const showResult = (text, isErr) => { result.textContent = text; result.className = `cv-result${text ? (isErr ? ' is-err' : ' is-ok') : ''}`; };

    function collect() {
      const out = {
        type: typeSelect.value,
        display_name: ids.display.value.trim() || undefined,
        base_url: ids.base.value.trim(),
        realtime_url: ids.realtime.value.trim() || undefined,
        timeout_ms: Number(ids.timeout.value) || undefined,
        models: textToModels(modelsArea.value, base.models)
      };
      const env = ids.env.value.trim();
      if (env || existing) out.api_key_env = env || null;
      if (base.preset) out.preset = base.preset;
      if (base.requires_api_key === false) out.requires_api_key = false;
      const key = ids.apikey.value;
      if (key) out.api_key = key;
      if (clearKey.checked) out.clear_api_key = true;
      return out;
    }

    const keyHint = existing && existing.has_api_key
      ? '已设置。留空保持不变；输入新值将替换。'
      : '保存后不会回显。也可只填下方环境变量名。';

    return card(editing.isNew ? '添加服务商' : `编辑服务商：${base.display_name || editing.key}`,
      h('div', { class: 'cv-grid' },
        field('Key（唯一标识）', input('key', editing.key, 'text', existing ? { readonly: true } : {})),
        field('显示名', input('display', base.display_name)),
        field('类型', typeSelect),
        field('Base URL', input('base', base.base_url)),
        field('Realtime WebSocket URL', input('realtime', base.realtime_url), '仅 Realtime 模型需要；可留空并从工作区 Base URL 自动推导'),
        field('API Key', input('apikey', '', 'password', { autocomplete: 'new-password', placeholder: existing && existing.has_api_key ? '••••••••' : '' }), keyHint),
        field('API Key 环境变量', input('env', base.api_key_env), '例如 DEEPSEEK_API_KEY；没有内联密钥时读取该变量'),
        field('超时（毫秒）', input('timeout', base.timeout_ms, 'number')),
        existing && existing.has_api_key
          ? h('label', { class: 'cv-check cv-field' }, clearKey, h('span', { text: '清除已保存的密钥' }))
          : null,
        field('模型（id | 显示名 | 输入 | 输出 | 传输 | 音频模式）', modelsArea, '普通：model-id | 名称 | text,image | text | request；Omni：qwen3.8-omni-flash | Qwen Omni | text,image,audio,video | text | request | direct；实时型号把传输和音频模式都写 realtime。', true)),
      existing && (existing.has_custom_headers || existing.has_extra_body)
        ? h('p', { class: 'cv-hint', text: '此服务商包含自定义请求头或额外请求体：出于安全不在此显示，保存时会原样保留；需要修改请直接编辑 providers.yaml。' })
        : null,
      h('div', { class: 'cv-actions' },
        h('button', {
          class: 'y-btn', type: 'button', text: '发现模型',
          onclick: async () => {
            try {
              showResult('发现中…');
              const data = await api('POST', '/api/config/models/discover', { provider: collect(), provider_key: existing ? editing.key : undefined });
              if (!data.ok) return showResult(`失败：${data.error}`, true);
              const have = new Set(textToModels(modelsArea.value).map((m) => m.id));
              const extra = data.models.map((m) => m.id).filter((id) => !have.has(id));
              modelsArea.value = [modelsArea.value.trim(), ...extra].filter(Boolean).join('\n');
              return showResult(`发现 ${data.models.length} 个模型，新增 ${extra.length} 个到列表`);
            } catch (err) { return showResult(err.message, true); }
          }
        }),
        h('button', {
          class: 'y-btn', type: 'button', text: '测试连接',
          onclick: async () => {
            try {
              showResult('测试中…');
              const data = await api('POST', '/api/config/models/test', { provider: collect(), provider_key: existing ? editing.key : undefined });
              showResult(data.ok ? `连接成功，${data.latency_ms} ms` : `失败 (${data.status ?? '网络'})：${data.error}`, !data.ok);
            } catch (err) { showResult(err.message, true); }
          }
        }),
        h('button', {
          class: 'y-btn y-btn--primary', type: 'button', text: '保存服务商',
          onclick: async () => {
            try {
              const key = ids.key.value.trim();
              if (!key) throw new Error('Key 不能为空');
              state = await api('PUT', `/api/config/models/providers/${encodeURIComponent(key)}`, collect());
              editing = null; resetDraft(); rerender(); toast('服务商已保存');
            } catch (err) { showResult(err.message, true); }
          }
        }),
        !editing.isNew ? h('button', {
          class: 'y-btn cv-danger', type: 'button', text: '删除',
          onclick: async () => {
            if (!window.confirm(`删除服务商 ${editing.key}？相关的启用、回退和用途引用会一并清理。`)) return;
            try {
              state = await api('DELETE', `/api/config/models/providers/${encodeURIComponent(editing.key)}`);
              editing = null; resetDraft(); rerender(); toast('已删除');
            } catch (err) { showResult(err.message, true); }
          }
        }) : null,
        h('button', { class: 'y-btn y-btn--ghost', type: 'button', text: '取消', onclick: () => { editing = null; rerender(); } })),
      result);
  }

  // ---- selection ----
  async function saveSelection() {
    try {
      const enabled = state.models.map((m) => m.ref).filter((r) => draft.enabled.has(r));
      state = await api('PUT', '/api/config/models/selection', {
        active_model: draft.active,
        enabled_models: enabled,
        roles: draft.roles,
        fallback_models: draft.fallback.filter(Boolean)
      });
      resetDraft(); rerender(); toast('模型选择已保存');
    } catch (err) { toast(err.message, true); }
  }

  function renderSelection() {
    const byProvider = new Map();
    for (const m of state.models) {
      if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
      byProvider.get(m.provider).push(m);
    }
    const groups = [];
    for (const [provider, models] of byProvider) {
      groups.push(h('div', { class: 'cv-group-label', text: state.providers[provider]?.display_name || provider }));
      for (const m of models) {
        groups.push(h('div', { class: 'cv-row cv-row--model' },
          h('label', { class: 'cv-check', title: '启用后可在聊天窗口的模型选择器中切换' },
            h('input', { type: 'checkbox', checked: draft.enabled.has(m.ref), onchange: (e) => { if (e.target.checked) draft.enabled.add(m.ref); else draft.enabled.delete(m.ref); } }),
            h('span', { text: '启用' })),
          h('label', { class: 'cv-check' },
            h('input', { type: 'radio', name: 'cv-active', checked: draft.active === m.ref, onchange: () => { draft.active = m.ref; draft.enabled.add(m.ref); rerender(); } }),
            h('span', { text: '默认' })),
          h('div', { class: 'cv-row-main' }, h('strong', { text: m.name || m.id }), h('span', { class: 'cv-mono cv-dim', text: m.ref })),
          h('div', { class: 'cv-row-meta' },
            m.reasoning ? chip('推理') : null,
            (m.input || []).includes('image') ? chip('看图') : null,
            (m.input || []).includes('audio') ? chip(m.transport === 'realtime' ? '实时语音' : '音频直通', 'good') : null,
            !m.has_api_key && state.providers[m.provider]?.requires_api_key ? chip('缺少密钥', 'warn') : null)));
      }
    }

    const roles = h('div', { class: 'cv-grid' }, ROLES.map(([role, label]) => field(`${label}（${role}）`,
      h('select', { class: 'y-input', onchange: (e) => { if (e.target.value) draft.roles[role] = e.target.value; else delete draft.roles[role]; } },
        modelOptions(draft.roles[role], '使用默认模型')))));

    const fallback = h('div', { class: 'cv-fallback' });
    draft.fallback.forEach((ref, i) => fallback.append(h('div', { class: 'cv-actions' },
      h('span', { class: 'cv-dim', text: `${i + 1}.` }),
      h('select', { class: 'y-input', onchange: (e) => { draft.fallback[i] = e.target.value; } }, modelOptions(ref)),
      h('button', { class: 'y-btn y-btn--ghost', type: 'button', text: '移除', onclick: () => { draft.fallback.splice(i, 1); rerender(); } }))));
    fallback.append(h('button', {
      class: 'y-btn', type: 'button', text: '添加回退模型', disabled: state.models.length === 0,
      onclick: () => { draft.fallback.push(state.models[0].ref); rerender(); }
    }));

    return [
      card('启用模型与默认模型',
        h('p', { class: 'cv-hint', text: '勾选的模型会出现在聊天窗口的模型选择器里；「默认」是新会话使用的模型。' }),
        state.models.length ? h('div', { class: 'cv-list' }, groups) : h('p', { class: 'cv-hint', text: '没有可用模型，请先添加服务商。' })),
      card('按用途分配', h('p', { class: 'cv-hint', text: '看图、摘要等场景可以单独指定模型，未指定时使用默认模型。' }), roles),
      card('回退链', h('p', { class: 'cv-hint', text: '默认模型遇到网络错误、429 或 5xx 时，按顺序尝试下列模型。' }), fallback),
      h('div', { class: 'cv-savebar' },
        h('span', { class: 'cv-hint', text: '修改模型选择后需点击保存。' }),
        h('button', { class: 'y-btn y-btn--ghost', type: 'button', text: '还原', onclick: () => { resetDraft(); rerender(); } }),
        h('button', { class: 'y-btn y-btn--primary', type: 'button', text: '保存选择', onclick: saveSelection }))
    ];
  }

  register('models', {
    async render(root, isCurrent) {
      [state, presets] = await Promise.all([api('GET', '/api/config/models'), api('GET', '/api/config/models/presets')]);
      if (!isCurrent()) return;
      resetDraft();
      rerender = () => {
        root.replaceChildren(
          h('header', { class: 'cv-page-head' }, h('h1', { text: '模型与路由' }), h('p', { class: 'cv-hint', text: '配置对话服务商、选择启用与默认模型，保存后新会话立即生效。' })),
          ...[renderProviders(), editing ? renderEditor() : null, ...renderSelection()].filter(Boolean));
      };
      rerender();
    }
  });
})();
