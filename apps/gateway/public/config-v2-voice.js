// config-v2-voice.js — 「语音」页：TTS / ASR 服务商结构化配置（contract C8）。
(function () {
  const { h, api, toast, chip, field, card, register } = window.CV2;

  const TYPE_INFO = {
    tts_dashscope: {
      label: '通义千问 / DashScope TTS', kind: 'tts',
      defaults: { base_url: 'https://dashscope.aliyuncs.com/api/v1', api_key_env: 'DASHSCOPE_API_KEY', tts_model: 'qwen3-tts-flash', tts_voice: 'Cherry' }
    },
    tts_openai_compatible: {
      label: 'OpenAI 兼容 TTS（/audio/speech）', kind: 'tts',
      defaults: { base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY', tts_model: 'gpt-4o-mini-tts', tts_voice: 'alloy', format: 'mp3' }
    },
    asr_dashscope: {
      label: '阿里云 DashScope ASR', kind: 'asr',
      defaults: { base_url: 'https://dashscope.aliyuncs.com/api/v1', api_key_env: 'DASHSCOPE_API_KEY', model: 'paraformer-v2' }
    },
    asr_openai_compatible: {
      label: 'OpenAI 兼容 ASR（/audio/transcriptions）', kind: 'asr',
      defaults: { base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY', model: 'whisper-1' }
    }
  };
  const DESKTOP_PATH = { electron_native: '桌面原生（Electron 直连 TTS）', runtime_legacy: '运行时回放（经网关）' };
  const DESKTOP_TRANSPORT = { non_streaming: '非流式（整句合成后播放）', realtime: '实时流式' };

  let data = null;
  let rerender = () => {};
  const editing = { tts: null, asr: null }; // { key, isNew, type }
  let audioEl = null;

  function providersOf(kind) { return data.providers.filter((p) => p.kind === kind); }

  async function setActive(kind, key) {
    try {
      data = await api('PUT', '/api/config/voice/selection', { [`active_${kind}`]: key });
      toast(kind === 'tts' ? '已切换语音合成服务商' : '已切换语音识别服务商');
      rerender();
    } catch (err) { toast(err.message, true); }
  }

  function editor(kind) {
    const state = editing[kind];
    const existing = state.isNew ? null : data.providers.find((p) => p.key === state.key);
    const type = existing ? existing.type : state.type;
    const info = TYPE_INFO[type];
    const base = existing || { ...info.defaults, display_name: '', has_api_key: false, timeout_ms: null };
    const refs = {};
    const input = (name, value, opts = {}) => {
      refs[name] = h('input', { class: 'y-input', type: opts.type || 'text', value: value ?? '', autocomplete: 'off', spellcheck: false, placeholder: opts.placeholder || '', ...(opts.readonly ? { readonly: true } : {}) });
      return refs[name];
    };
    const clearKey = h('input', { type: 'checkbox' });
    const result = h('div', { class: 'cv-result', role: 'status' });
    const showResult = (text, isErr) => { result.textContent = text; result.className = `cv-result${text ? (isErr ? ' is-err' : ' is-ok') : ''}`; };
    const testText = h('input', { class: 'y-input', type: 'text', value: '你好，我是八千代。', maxlength: 200, 'aria-label': '试听文本' });

    const fields = [
      field('Key（唯一标识）', input('key', state.key, { readonly: Boolean(existing) })),
      field('显示名', input('display', base.display_name)),
      field('Base URL', input('base', base.base_url)),
      field('API Key', input('apikey', '', { type: 'password', placeholder: base.has_api_key ? '••••••••' : '' }),
        base.has_api_key ? '已设置。留空保持不变；输入新值将替换。' : '保存后不会回显。也可只填下方环境变量名。'),
      field('API Key 环境变量', input('env', base.api_key_env), '例如 DASHSCOPE_API_KEY'),
      field('超时（毫秒，可选）', input('timeout', base.timeout_ms, { type: 'number' }))
    ];
    if (kind === 'tts') {
      fields.push(field('合成模型', input('tts_model', base.tts_model)), field('音色', input('tts_voice', base.tts_voice)));
      if (type === 'tts_dashscope') {
        fields.push(
          field('实时合成模型（可选）', input('tts_realtime_model', base.tts_realtime_model), '例如 qwen3-tts-flash-realtime'),
          field('实时合成音色（可选）', input('tts_realtime_voice', base.tts_realtime_voice)));
      } else {
        fields.push(field('音频格式', input('format', base.format), 'mp3 / wav / opus 等，取决于服务商'));
      }
    } else {
      fields.push(field('识别模型', input('model', base.model)));
    }
    if (existing && existing.has_api_key) fields.push(h('label', { class: 'cv-check cv-field' }, clearKey, h('span', { text: '清除已保存的密钥' })));

    function collect() {
      const out = { type, display_name: refs.display.value.trim() || null, base_url: refs.base.value.trim(), api_key_env: refs.env.value.trim() || null };
      const t = Number(refs.timeout.value);
      out.timeout_ms = t > 0 ? t : null;
      for (const name of ['tts_model', 'tts_voice', 'tts_realtime_model', 'tts_realtime_voice', 'format', 'model']) {
        if (refs[name]) out[name] = refs[name].value.trim() || null;
      }
      if (refs.apikey.value) out.api_key = refs.apikey.value;
      if (clearKey.checked) out.clear_api_key = true;
      return out;
    }

    async function listen() {
      const key = state.isNew ? null : state.key;
      if (!key) return showResult('请先保存服务商，再试听。', true);
      showResult('合成中…');
      try {
        const res = await fetch('/api/config/voice/test-tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, text: testText.value.trim() })
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try { message = (await res.json()).error || message; } catch { /* binary */ }
          throw new Error(message);
        }
        const url = URL.createObjectURL(await res.blob());
        if (audioEl) { audioEl.pause(); URL.revokeObjectURL(audioEl.src); }
        audioEl = new Audio(url);
        await audioEl.play();
        return showResult('播放中（使用已保存的配置）', false);
      } catch (err) { return showResult(`试听失败：${err.message}`, true); }
    }

    return h('div', { class: 'cv-subpanel' },
      h('div', { class: 'cv-subhead' },
        h('strong', { text: state.isNew ? `添加：${info.label}` : `编辑：${existing.display_name || state.key}` }),
        chip(type)),
      h('div', { class: 'cv-grid' }, fields),
      kind === 'tts' ? h('div', { class: 'cv-actions' }, testText,
        h('button', { class: 'y-btn', type: 'button', text: '试听', onclick: listen })) : null,
      h('div', { class: 'cv-actions' },
        h('button', {
          class: 'y-btn y-btn--primary', type: 'button', text: '保存',
          onclick: async () => {
            try {
              const key = refs.key.value.trim();
              if (!key) throw new Error('Key 不能为空');
              data = await api('PUT', `/api/config/voice/providers/${encodeURIComponent(key)}`, collect());
              editing[kind] = { key, isNew: false };
              toast('已保存'); rerender();
            } catch (err) { showResult(err.message, true); }
          }
        }),
        !state.isNew ? h('button', {
          class: 'y-btn cv-danger', type: 'button', text: '删除',
          onclick: async () => {
            if (!window.confirm(`删除服务商 ${state.key}？`)) return;
            try {
              data = await api('DELETE', `/api/config/voice/providers/${encodeURIComponent(state.key)}`);
              editing[kind] = null; toast('已删除'); rerender();
            } catch (err) { showResult(err.message, true); }
          }
        }) : null,
        h('button', { class: 'y-btn y-btn--ghost', type: 'button', text: '关闭', onclick: () => { editing[kind] = null; rerender(); } })),
      result);
  }

  function section(kind) {
    const isTts = kind === 'tts';
    const list = providersOf(kind);
    const active = data[`active_${kind}`];
    const typeSelect = h('select', { class: 'y-input', 'aria-label': '服务商类型' },
      Object.entries(TYPE_INFO).filter(([, i]) => i.kind === kind).map(([t, i]) => h('option', { value: t, text: i.label })));
    const rows = list.map((p) => h('div', { class: `cv-row${p.key === active ? ' is-active' : ''}` },
      h('label', { class: 'cv-check', title: '设为当前' },
        h('input', { type: 'radio', name: `active-${kind}`, checked: p.key === active, onchange: () => setActive(kind, p.key) }),
        h('span', { text: '当前' })),
      h('div', { class: 'cv-row-main' }, h('strong', { text: p.display_name }),
        h('span', { class: 'cv-mono cv-dim', text: `${p.key} · ${isTts ? `${p.tts_model || '—'} / ${p.tts_voice || '—'}` : (p.model || '—')}` })),
      h('div', { class: 'cv-row-meta' }, chip(p.type),
        p.has_api_key ? chip('密钥已设置', 'good') : chip('缺少密钥', 'warn')),
      h('button', { class: 'y-btn', type: 'button', text: '编辑', onclick: () => { editing[kind] = { key: p.key, isNew: false }; rerender(); } })));
    return card(isTts ? '语音合成（TTS）' : '语音识别（ASR）',
      h('p', { class: 'cv-hint', text: isTts
        ? '选择八千代开口说话使用的服务商。实时流式合成仅 tts_dashscope 支持，其他类型自动使用非流式。'
        : '选择把你的语音转成文字的服务商，手机与电脑端共用。' }),
      rows.length ? h('div', { class: 'cv-list' }, rows) : h('p', { class: 'cv-hint', text: '尚未配置服务商。' }),
      h('div', { class: 'cv-actions' }, typeSelect,
        h('button', {
          class: 'y-btn', type: 'button', text: '添加服务商',
          onclick: () => {
            const type = typeSelect.value;
            const taken = new Set(data.providers.map((p) => p.key));
            let key = type;
            for (let i = 2; taken.has(key); i += 1) key = `${type}_${i}`;
            editing[kind] = { key, isNew: true, type };
            rerender();
          }
        })),
      editing[kind] ? editor(kind) : null);
  }

  function desktopCard() {
    const d = data.desktop || {};
    const row = (label, title, raw) => h('div', { class: 'cv-row' },
      h('span', { class: 'cv-label cv-key', text: label }),
      h('div', { class: 'cv-row-main' }, h('strong', { text: title }), h('span', { class: 'cv-mono cv-dim', text: raw || '' })));
    return card('桌面端语音通路',
      h('p', { class: 'cv-hint', text: '只读。桌面角色使用的播放路径与传输方式由 desktop-live2d.json 的 voice.path / voice.transport 决定，可在「高级」页修改。' }),
      h('div', { class: 'cv-list' },
        row('播放路径', DESKTOP_PATH[d.path] || d.path || '—', d.path),
        row('传输方式', DESKTOP_TRANSPORT[d.transport] || d.transport || '—', d.transport)),
      h('div', { class: 'cv-actions' }, h('a', { class: 'y-btn cv-linkbtn', href: '#advanced', text: '前往高级配置' })));
  }

  register('voice', {
    async render(root, isCurrent) {
      data = await api('GET', '/api/config/voice');
      if (!isCurrent()) return;
      rerender = () => root.replaceChildren(
        h('header', { class: 'cv-page-head' }, h('h1', { text: '语音' }), h('p', { class: 'cv-hint', text: '语音合成与识别服务商。切换后新的语音回复与识别立即使用新服务商。' })),
        section('tts'), section('asr'), desktopCard());
      rerender();
    }
  });
})();
