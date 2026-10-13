/* Device-local chat session list and persisted message history. */
(function (global) {
  'use strict';

  function create({ bridge, backdrop, panel, list, messages, status, closeButton, newButton, composer, input, onSessionChanged, onSend }) {
    const state = { open: false, mode: 'closed', busy: false, currentId: '', sessions: [], refreshTimer: 0, closeTimer: 0, orientationTimer: 0 };
    panel.dataset.landscape = global.innerWidth > global.innerHeight ? '1' : '0';

    function dateLabel(value) {
      const date = new Date(value || 0);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    }

    function renderList() {
      list.replaceChildren(...state.sessions.map((session) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `session-history-item${session.session_id === state.currentId ? ' active' : ''}`;
        button.dataset.sessionId = session.session_id;
        button.disabled = state.busy;
        const title = document.createElement('strong');
        title.textContent = String(session.title || '新对话');
        const meta = document.createElement('span');
        meta.textContent = `${Number(session.message_count) || 0} 条 · ${dateLabel(session.updated_at)}`;
        button.append(title, meta);
        return button;
      }));
      if (!state.sessions.length) {
        const empty = document.createElement('p');
        empty.className = 'session-history-empty';
        empty.textContent = '还没有历史对话';
        list.append(empty);
      }
    }

    function messageNode(message) {
        const row = document.createElement('article');
        row.className = `session-history-message ${message.role === 'user' ? 'user' : 'assistant'}`;
        const content = document.createElement('div');
        if (global.YachiyoMarkdown) global.YachiyoMarkdown.renderInto(content, String(message.content || ''));
        else content.textContent = String(message.content || '');
        const time = document.createElement('time');
        time.textContent = dateLabel(message.created_at);
        row.append(content, time);
        return row;
    }

    function renderHistory(history) {
      const items = Array.isArray(history?.messages) ? history.messages : [];
      messages.replaceChildren(...items.map(messageNode));
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'session-history-empty';
        empty.textContent = '新对话尚无消息';
        messages.append(empty);
      }
      messages.scrollTop = messages.scrollHeight;
    }

    async function refresh({ loadHistory = true } = {}) {
      if (state.busy) return;
      state.busy = true;
      status.textContent = '正在同步会话…';
      renderList();
      try {
        const result = await bridge.rpc('session.list', { limit: 80 }, '', 8000);
        state.currentId = String(result?.current_session_id || '');
        state.sessions = Array.isArray(result?.items) ? result.items : [];
        renderList();
        if (loadHistory && state.currentId) {
          renderHistory(await bridge.rpc('session.history', { session_id: state.currentId }, '', 8000));
        }
        status.textContent = `${state.sessions.length} 个会话`;
      } catch (error) {
        status.textContent = `同步失败：${error?.message || error}`;
      } finally {
        state.busy = false;
        renderList();
      }
    }

    async function select(sessionId) {
      const normalized = String(sessionId || '').trim();
      if (!normalized || state.busy || normalized === state.currentId) return;
      state.busy = true;
      status.textContent = '正在切换会话…';
      renderList();
      try {
        const history = await bridge.rpc('session.select', { session_id: normalized }, '', 8000);
        state.currentId = normalized;
        renderHistory(history);
        renderList();
        status.textContent = '已切换，会话上下文与工具状态已恢复';
        onSessionChanged?.(normalized);
      } catch (error) {
        status.textContent = `切换失败：${error?.message || error}`;
      } finally {
        state.busy = false;
        renderList();
      }
    }

    async function createSession() {
      if (state.busy) return;
      state.busy = true;
      status.textContent = '正在创建新对话…';
      try {
        const history = await bridge.rpc('session.create', {}, '', 8000);
        state.currentId = String(history?.session_id || '');
        renderHistory(history);
        onSessionChanged?.(state.currentId);
      } catch (error) {
        status.textContent = `创建失败：${error?.message || error}`;
      } finally {
        state.busy = false;
        await refresh({ loadHistory: false });
      }
    }

    function setMode(mode) {
      const next = ['peek', 'full'].includes(mode) ? mode : 'closed';
      const wasOpen = state.open;
      state.mode = next;
      state.open = next !== 'closed';
      clearTimeout(state.closeTimer);
      if (state.open) backdrop.hidden = false;
      backdrop.dataset.state = next;
      panel.dataset.state = next;
      backdrop.classList.toggle('open', state.open);
      if (state.open) {
        requestAnimationFrame(() => panel.classList.add('open'));
        if (!wasOpen) void refresh();
      } else {
        panel.classList.remove('open');
        state.closeTimer = setTimeout(() => { if (!state.open) backdrop.hidden = true; }, 380);
      }
    }

    function expand() {
      if (!state.open) setMode('peek');
      else if (state.mode === 'peek') setMode('full');
    }

    function retreat() {
      if (state.mode === 'full') setMode('peek');
      else setMode('closed');
    }

    function scheduleRefresh() {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(() => { if (state.open) void refresh(); }, 450);
    }

    function onOrientationChange(landscape) {
      const value = landscape ? '1' : '0';
      clearTimeout(state.orientationTimer);
      if (!state.open) {
        panel.dataset.landscape = value;
        return;
      }
      panel.classList.remove('orientation-in');
      panel.classList.add('orientation-out');
      state.orientationTimer = setTimeout(() => {
        panel.dataset.landscape = value;
        panel.classList.remove('orientation-out');
        panel.classList.add('orientation-in');
        state.orientationTimer = setTimeout(() => panel.classList.remove('orientation-in'), 260);
      }, 140);
    }

    list.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-session-id]');
      if (button) void select(button.dataset.sessionId);
    });
    closeButton.addEventListener('click', retreat);
    newButton.addEventListener('click', () => { void createSession(); });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && state.mode === 'peek') setMode('closed');
    });
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = String(input.value || '').trim();
      if (!text || !state.currentId) return;
      onSend?.(text, state.currentId);
      messages.append(messageNode({ role: 'user', content: text, created_at: Date.now() }));
      messages.scrollTop = messages.scrollHeight;
      input.value = '';
      status.textContent = '已发送，等待八千代回复';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });

    let pull = null;
    panel.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('button,input,textarea,.session-history-list,.session-history-messages,.session-history-composer')) return;
      pull = { id: event.pointerId, y: event.clientY, done: false };
    }, { passive: true });
    panel.addEventListener('pointermove', (event) => {
      if (!pull || pull.id !== event.pointerId || pull.done) return;
      const dy = event.clientY - pull.y;
      if (dy > 36) { pull.done = true; expand(); }
      else if (dy < -36) { pull.done = true; retreat(); }
    }, { passive: true });
    const endPull = (event) => { if (!pull || pull.id === event.pointerId) pull = null; };
    panel.addEventListener('pointerup', endPull, { passive: true });
    panel.addEventListener('pointercancel', endPull, { passive: true });

    return {
      open: expand, expand, retreat, close: () => setMode('closed'), refresh, scheduleRefresh, onOrientationChange,
      accepts: (sessionId) => !sessionId || !state.currentId || sessionId === state.currentId,
      get isOpen() { return state.open; }, get mode() { return state.mode; }, get currentSessionId() { return state.currentId; }
    };
  }

  global.YachiyoSessionHistory = { create };
})(window);
