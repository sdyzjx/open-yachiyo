/* Device-local chat session list and persisted message history. */
(function (global) {
  'use strict';

  function resolvePullRelease({ edge, viewportHeight, direction }) {
    const midpoint = Math.max(1, Number(viewportHeight) || 1) / 2;
    if (direction === 'down') return Number(edge) >= midpoint ? 'full' : 'peek';
    return Number(edge) <= midpoint ? 'closed' : 'peek';
  }

  function create({ bridge, backdrop, panel, list, messages, status, closeButton, newButton, composer, input, onSessionChanged, onSend }) {
    const state = { open: false, mode: 'closed', busy: false, currentId: '', sessions: [], refreshTimer: 0, closeTimer: 0, orientationTimer: 0, settleTimer: 0, drag: null, suppressBackdropClick: false };
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
      clearTimeout(state.settleTimer);
      state.drag = null;
      state.mode = next;
      state.open = next !== 'closed';
      panel.classList.remove('dragging', 'settling');
      panel.style.removeProperty('--history-drag-height');
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

    function viewportHeight() {
      return Math.max(1, Number(global.innerHeight) || backdrop.clientHeight || panel.parentElement?.clientHeight || 1);
    }

    function modeEdge(mode = state.mode) {
      const height = viewportHeight();
      if (mode === 'full') return height;
      if (mode === 'peek') return panel.dataset.landscape === '1' ? Math.min(height * .82, 500) : Math.min(height * .5, 520);
      return 0;
    }

    function beginPull({ startY, followPointer = false } = {}) {
      if (state.drag) return false;
      const y = Number(startY);
      if (!Number.isFinite(y)) return false;
      clearTimeout(state.closeTimer);
      clearTimeout(state.settleTimer);
      const startMode = state.mode;
      state.drag = { startY: y, startEdge: followPointer ? y : modeEdge(), edge: followPointer ? y : modeEdge(), direction: null, moved: false, startMode };
      return true;
    }

    function updatePull(clientY) {
      const drag = state.drag;
      const y = Number(clientY);
      if (!drag || !Number.isFinite(y)) return false;
      const dy = y - drag.startY;
      if (!drag.moved && Math.abs(dy) < 8) return false;
      drag.moved = true;
      drag.direction = dy >= 0 ? 'down' : 'up';
      drag.edge = Math.max(0, Math.min(viewportHeight(), drag.startEdge + dy));
      state.open = true;
      backdrop.hidden = false;
      backdrop.dataset.state = 'drag';
      panel.dataset.state = 'drag';
      backdrop.classList.add('open', 'dragging');
      panel.classList.add('open', 'dragging');
      panel.style.setProperty('--history-drag-height', `${drag.edge}px`);
      return true;
    }

    function settlePull(targetMode) {
      const next = ['peek', 'full'].includes(targetMode) ? targetMode : 'closed';
      const targetEdge = modeEdge(next);
      state.mode = next;
      state.open = next !== 'closed';
      backdrop.dataset.state = next;
      panel.dataset.state = next;
      backdrop.classList.remove('dragging');
      panel.classList.remove('dragging');
      panel.classList.add('settling', 'open');
      panel.style.setProperty('--history-drag-height', `${targetEdge}px`);
      clearTimeout(state.settleTimer);
      state.settleTimer = setTimeout(() => {
        panel.classList.remove('settling');
        panel.style.removeProperty('--history-drag-height');
        if (!state.open) {
          panel.classList.remove('open');
          backdrop.classList.remove('open');
          backdrop.hidden = true;
        }
      }, 360);
    }

    function endPull({ cancelled = false } = {}) {
      const drag = state.drag;
      state.drag = null;
      if (!drag?.moved) return false;
      const next = cancelled
        ? drag.startMode
        : resolvePullRelease({ edge: drag.edge, viewportHeight: viewportHeight(), direction: drag.direction });
      settlePull(next);
      if (drag.startMode === 'closed' && next !== 'closed') void refresh();
      return true;
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
      if (state.suppressBackdropClick) {
        state.suppressBackdropClick = false;
        return;
      }
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

    let pointerId = null;
    function startInternalPull(event) {
      if (event.target.closest?.('button,input,textarea,.session-history-list,.session-history-messages,.session-history-composer')) return;
      pointerId = event.pointerId;
      beginPull({ startY: event.clientY });
      try { event.currentTarget.setPointerCapture(pointerId); } catch {}
    }
    function moveInternalPull(event) {
      if (pointerId !== event.pointerId) return;
      updatePull(event.clientY);
    }
    function finishInternalPull(event, cancelled = false) {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      endPull({ cancelled });
    }
    panel.addEventListener('pointerdown', startInternalPull, { passive: true });
    panel.addEventListener('pointermove', moveInternalPull, { passive: true });
    panel.addEventListener('pointerup', (event) => finishInternalPull(event), { passive: true });
    panel.addEventListener('pointercancel', (event) => finishInternalPull(event, true), { passive: true });

    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target !== backdrop || state.mode !== 'peek') return;
      pointerId = event.pointerId;
      beginPull({ startY: event.clientY, followPointer: true });
      try { backdrop.setPointerCapture(pointerId); } catch {}
    }, { passive: true });
    backdrop.addEventListener('pointermove', moveInternalPull, { passive: true });
    backdrop.addEventListener('pointerup', (event) => {
      if (pointerId !== event.pointerId) return;
      const dragged = endPull();
      pointerId = null;
      state.suppressBackdropClick = dragged;
    }, { passive: true });
    backdrop.addEventListener('pointercancel', (event) => finishInternalPull(event, true), { passive: true });

    return {
      open: expand, expand, retreat, close: () => setMode('closed'), refresh, scheduleRefresh, onOrientationChange,
      beginPull, updatePull, endPull,
      accepts: (sessionId) => !sessionId || !state.currentId || sessionId === state.currentId,
      get isOpen() { return state.open; }, get mode() { return state.mode; }, get currentSessionId() { return state.currentId; }
    };
  }

  global.YachiyoSessionHistory = { create, resolvePullRelease };
})(window);
