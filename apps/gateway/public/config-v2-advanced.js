// config-v2-advanced.js — 「高级」页：原始文件编辑、版本历史、配置 Agent。默认全部折叠。
// providers.yaml 不在此处提供原始编辑器：请使用「模型与路由」「语音」页的结构化接口。
(function () {
  const { h, api, toast, card, register } = window.CV2;
  const FILES = [
    { id: 'tools', title: 'tools.yaml', desc: '工具开关与执行策略', url: '/api/config/tools/raw', key: 'yaml', git: 'tools.yaml' },
    { id: 'skills', title: 'skills.yaml', desc: '技能启用与来源', url: '/api/config/skills/raw', key: 'yaml', git: 'skills.yaml' },
    { id: 'persona', title: 'persona.yaml', desc: '人格与回复风格', url: '/api/config/persona/raw', key: 'yaml', git: 'persona.yaml' },
    { id: 'voice-policy', title: 'voice-policy.yaml', desc: '语音回复策略（何时朗读）', url: '/api/config/voice-policy/raw', key: 'yaml', git: 'voice-policy.yaml' },
    { id: 'desktop-live2d', title: 'desktop-live2d.json', desc: '桌面角色窗口与语音通路（含注释的 JSON）', url: '/api/config/desktop-live2d/raw', key: 'json', git: 'desktop-live2d.json' }
  ];
  const AGENT_SESSION_ID = 'config-v2-agent';

  function fileSection(file) {
    const editor = h('textarea', { class: 'y-input cv-editor cv-mono', spellcheck: false, rows: 16, 'aria-label': `${file.title} 编辑器` });
    const status = h('span', { class: 'cv-hint' });
    const history = h('div', { class: 'cv-history' });
    let loaded = false;
    const setStatus = (text, err) => { status.textContent = text; status.className = `cv-hint${err ? ' is-err' : ''}`; };

    async function load() {
      setStatus('加载中…');
      try {
        const data = await api('GET', file.url);
        editor.value = data[file.key] || '';
        setStatus('已加载');
      } catch (err) { setStatus(err.message, true); }
    }
    async function loadHistory() {
      history.replaceChildren(h('span', { class: 'cv-hint', text: '加载中…' }));
      try {
        const data = await api('GET', `/api/config/git/log?file=${encodeURIComponent(file.git)}&limit=8`);
        const commits = data.commits || [];
        history.replaceChildren(...(commits.length ? commits.map((c, i) => h('div', { class: 'cv-row cv-row--tight' },
          h('span', { class: 'cv-mono cv-dim', text: c.short }),
          h('span', { class: 'cv-row-main cv-ellipsis', title: c.subject, text: c.subject }),
          h('span', { class: 'cv-dim', text: new Date(c.date).toLocaleString('zh-CN', { hour12: false }) }),
          h('button', {
            class: 'y-btn y-btn--ghost', type: 'button', text: '预览',
            onclick: async () => {
              try {
                const d = await api('GET', `/api/config/git/show?hash=${c.hash}&file=${encodeURIComponent(file.git)}`);
                editor.value = d.content; setStatus(`正在预览 ${c.short}（未保存）`);
              } catch (err) { setStatus(err.message, true); }
            }
          }),
          i > 0 ? h('button', {
            class: 'y-btn y-btn--ghost', type: 'button', text: '恢复',
            onclick: async () => {
              if (!window.confirm(`将 ${file.title} 恢复到 ${c.short}？\n${c.subject}`)) return;
              try {
                await api('POST', '/api/config/git/restore', { hash: c.hash, file: file.git });
                toast('已恢复'); await load(); await loadHistory();
              } catch (err) { setStatus(err.message, true); }
            }
          }) : null)) : [h('span', { class: 'cv-hint', text: '暂无提交记录' })]));
      } catch (err) { history.replaceChildren(h('span', { class: 'cv-hint is-err', text: err.message })); }
    }

    const historyBox = h('details', { class: 'cv-details cv-details--inner' }, h('summary', { text: '版本历史' }), history);
    historyBox.addEventListener('toggle', () => { if (historyBox.open) loadHistory(); });

    const box = h('details', { class: 'cv-details' },
      h('summary', {}, h('span', { class: 'cv-mono', text: file.title }), h('span', { class: 'cv-dim', text: file.desc })),
      h('div', { class: 'cv-details-body' }, editor,
        h('div', { class: 'cv-actions' }, status,
          h('button', { class: 'y-btn', type: 'button', text: '重新加载', onclick: load }),
          h('button', {
            class: 'y-btn y-btn--primary', type: 'button', text: '保存',
            onclick: async () => {
              setStatus('保存中…');
              try {
                await api('PUT', file.url, { [file.key]: editor.value });
                setStatus('已保存'); toast(`${file.title} 已保存`);
                if (historyBox.open) loadHistory();
              } catch (err) { setStatus(err.message, true); }
            }
          })),
        historyBox));
    box.addEventListener('toggle', () => { if (box.open && !loaded) { loaded = true; load(); } });
    return box;
  }

  function agentSection() {
    const log = h('div', { class: 'cv-agent-log y-scroll', role: 'log', 'aria-live': 'polite' });
    const input = h('input', { class: 'y-input', type: 'text', placeholder: '问 Agent 如何修改配置…', autocomplete: 'off' });
    let ws = null; let pending = null;
    const push = (role, text) => {
      const node = h('div', { class: `cv-msg cv-msg--${role}`, text });
      log.append(node); log.scrollTop = log.scrollHeight; return node;
    };
    function connect() {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.addEventListener('message', (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        const sid = msg.session_id || msg.data?.session_id || msg.params?.session_id;
        if (sid && sid !== AGENT_SESSION_ID) return;
        if (!pending) return;
        if (msg.type === 'final') { pending.textContent = msg.output || '（无回复）'; pending = null; }
        else if (msg.type === 'error') { pending.textContent = `错误：${msg.message || '未知错误'}`; pending = null; }
      });
    }
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) { toast('Agent 尚未连接，请稍候重试', true); return; }
      input.value = ''; push('user', text); pending = push('agent', '…');
      ws.send(JSON.stringify({ type: 'run', session_id: AGENT_SESSION_ID, input: text }));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } });
    const box = h('details', { class: 'cv-details' },
      h('summary', {}, h('span', { text: '配置 Agent' }), h('span', { class: 'cv-dim', text: '用对话方式协助修改配置（会使用当前模型）' })),
      h('div', { class: 'cv-details-body' }, log,
        h('div', { class: 'cv-actions' }, input, h('button', { class: 'y-btn y-btn--primary', type: 'button', text: '发送', onclick: send }))));
    box.addEventListener('toggle', () => { if (box.open && !ws) connect(); });
    return box;
  }

  register('advanced', {
    async render(root) {
      root.append(
        h('header', { class: 'cv-page-head' }, h('h1', { text: '高级' }),
          h('p', { class: 'cv-hint', text: '直接编辑底层配置文件。改动保存后立即写入并记录版本；多数情况下请优先使用「模型与路由」和「语音」页。' })),
        card('配置文件',
          h('p', { class: 'cv-hint', text: 'providers.yaml 含密钥，不提供原始编辑；请使用结构化页面。' }),
          h('div', { class: 'cv-stack' }, FILES.map(fileSection))),
        card('助手', h('div', { class: 'cv-stack' }, agentSection())));
    }
  });
})();
