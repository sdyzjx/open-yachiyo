/* Task canvas: split landscape lanes plus a merged portrait/drawer view. */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const STATUS_ICON = { running: '◔', done: '✓', failed: '✕', pending: '○' };
  const MAX_BUBBLES = 8;
  const STALE_STREAM_MS = 30000;

  function createCanvas({ root }) {
    const L = global.YachiyoLayout;

    function createView(name) {
      const scroll = el('div', `chat-scroll chat-${name}`);
      const bubbles = el('div', 'tc-bubbles');
      const tasks = el('div', 'tc-tasks');
      scroll.append(bubbles, tasks);
      const view = { name, scroll, bubbles, tasks, stick: true, pinRaf: 0, lastTouch: 0 };
      const nearBottom = () => (L ? L.isNearBottom(scroll) : scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 24);
      scroll.addEventListener('scroll', () => { view.stick = nearBottom(); }, { passive: true });
      for (const event of ['touchstart', 'touchmove', 'pointerdown']) {
        scroll.addEventListener(event, () => { view.lastTouch = Date.now(); }, { passive: true });
      }
      return view;
    }

    const agentView = createView('agent');
    const userView = createView('user');
    const mergedView = createView('merged');
    root.append(agentView.scroll, userView.scroll, mergedView.scroll);

    function pin(view, force = false) {
      if (force) view.stick = true;
      if (!view.stick || view.pinRaf) return;
      view.pinRaf = requestAnimationFrame(() => { view.pinRaf = 0; view.scroll.scrollTop = view.scroll.scrollHeight; });
    }

    const groups = [];
    let liveCount = 0;
    const assistants = new Map();
    const completedTraces = new Set();
    const taskEls = new Map();

    function traceKey(meta) {
      return meta && typeof meta.trace_id === 'string' && meta.trace_id ? meta.trace_id : '__default__';
    }

    function rememberCompleted(key) {
      if (key === '__default__') return;
      completedTraces.add(key);
      while (completedTraces.size > 128) completedTraces.delete(completedTraces.values().next().value);
    }

    function refreshVisibility() {
      const has = liveCount > 0;
      if (has && !root.classList.contains('has-content')) {
        root.classList.remove('panel-in'); void root.offsetWidth; root.classList.add('panel-in');
      }
      root.classList.toggle('has-content', has);
    }

    function removeGroup(group) {
      if (!group || !group.alive) return;
      clearTimeout(group.fadeTimer);
      group.fadeTimer = 0;
      group.alive = false;
      for (const entry of group.nodes) entry.node.remove();
      liveCount = Math.max(0, liveCount - 1);
      refreshVisibility();
    }

    function makeBubble(role, text) {
      const targets = role === 'user' ? [userView, mergedView] : [agentView, mergedView];
      const nodes = targets.map((view) => {
        const node = el('div', `tc-bubble tc-${role}`, text);
        view.bubbles.appendChild(node);
        return { view, node };
      });
      const group = { kind: 'bubble', role, nodes, alive: true, fadeTimer: 0 };
      groups.push(group);
      liveCount += 1;
      const bubbles = groups.filter((item) => item.kind === 'bubble' && item.alive);
      if (bubbles.length > MAX_BUBBLES) removeGroup(bubbles[0]);
      return group;
    }

    function fade(group) {
      if (!group || !group.alive) return;
      if (group.nodes.some(({ view }) => Date.now() - view.lastTouch < 4000)) {
        scheduleFade(group, 2000);
        return;
      }
      for (const { node } of group.nodes) node.classList.add('tc-out');
      group.fadeTimer = setTimeout(() => removeGroup(group), 420);
    }

    function scheduleFade(group, delay) {
      if (!group || !group.alive) return;
      clearTimeout(group.fadeTimer);
      group.fadeTimer = setTimeout(() => fade(group), delay);
    }

    function scheduleStreamExpiry(key, state) {
      clearTimeout(state.group.fadeTimer);
      state.group.fadeTimer = setTimeout(() => {
        if (assistants.get(key) === state) {
          assistants.delete(key);
          rememberCompleted(key);
        }
        fade(state.group);
      }, STALE_STREAM_MS);
    }

    function showUser(text) {
      if (!text) return;
      const group = makeBubble('user', text);
      refreshVisibility();
      pin(userView, true);
      pin(mergedView, true);
      scheduleFade(group, 12000);
    }

    function delta(text, meta) {
      if (!text) return;
      const key = traceKey(meta);
      if (completedTraces.has(key)) return;
      let state = assistants.get(key);
      if (!state) {
        state = { group: makeBubble('assistant', ''), text: '' };
        assistants.set(key, state);
      }
      state.text += text;
      for (const { node } of state.group.nodes) node.textContent = state.text;
      scheduleStreamExpiry(key, state);
      refreshVisibility();
      pin(agentView);
      pin(mergedView);
    }

    function final(text, meta) {
      const key = traceKey(meta);
      if (completedTraces.has(key)) return;
      let state = assistants.get(key);
      if (text) {
        if (!state) state = { group: makeBubble('assistant', ''), text: '' };
        state.text = String(text);
        for (const { node } of state.group.nodes) node.textContent = state.text;
      }
      const group = state && state.group;
      assistants.delete(key);
      rememberCompleted(key);
      refreshVisibility();
      pin(agentView);
      pin(mergedView);
      if (group) {
        const length = group.nodes[0].node.textContent.length;
        scheduleFade(group, Math.min(60000, 16000 + length * 90));
      }
    }

    function updateTask(task) {
      if (!task || !task.task_id) return;
      let card = taskEls.get(task.task_id);
      if (!card) {
        const nodes = [agentView, mergedView].map((view) => {
          const node = el('div', 'tc-task');
          const title = el('div', 'tc-task-title');
          const steps = el('ul', 'tc-steps');
          node.append(title, steps);
          view.tasks.appendChild(node);
          return { view, node, title, steps };
        });
        card = { kind: 'task', nodes, alive: true, timer: 0 };
        groups.push(card);
        liveCount += 1;
        taskEls.set(task.task_id, card);
        refreshVisibility();
      }
      for (const entry of card.nodes) {
        entry.node.dataset.status = task.status || 'running';
        entry.title.textContent = `${STATUS_ICON[task.status] || STATUS_ICON.running} ${task.title || task.task_id}`;
        entry.steps.replaceChildren(...(task.steps || []).slice(-4).map((step) =>
          el('li', `tc-step st-${step.status}`, `${STATUS_ICON[step.status] || '·'} ${step.name}`)));
      }
      pin(agentView);
      pin(mergedView);
      clearTimeout(card.timer);
      if (task.status === 'done' || task.status === 'failed') {
        card.timer = setTimeout(() => { fade(card); taskEls.delete(task.task_id); }, 8000);
      }
    }

    function setViewLayout(view, layout, interactive) {
      const style = view.scroll.style;
      style.left = `${layout.left}px`;
      style.top = `${layout.top}px`;
      style.width = `${layout.width}px`;
      style.height = `${layout.height}px`;
      style.setProperty('--chat-radius', `${layout.style.radius}px`);
      style.setProperty('--chat-opacity', String(layout.style.opacity));
      style.opacity = String(layout.hidden ? 0 : layout.presence * layout.style.opacity);
      style.visibility = layout.hidden || layout.presence < 0.01 ? 'hidden' : 'visible';
      style.pointerEvents = interactive && !layout.hidden ? 'auto' : 'none';
    }

    function setPresentation(presentation) {
      if (!presentation) return;
      const splitInteractive = presentation.agent.presence >= presentation.merged.presence;
      setViewLayout(agentView, presentation.agent, splitInteractive);
      setViewLayout(userView, presentation.user, splitInteractive);
      setViewLayout(mergedView, presentation.merged, !splitInteractive);
    }

    return {
      showUser, delta, final, updateTask, setPresentation, element: root,
      scrollEl: mergedView.scroll, mergedScrollEl: mergedView.scroll,
      agentScrollEl: agentView.scroll, userScrollEl: userView.scroll,
      get stuck() { return mergedView.stick; },
      get agentStuck() { return agentView.stick; },
      get userStuck() { return userView.stick; }
    };
  }

  global.YachiyoTaskCanvas = { createCanvas };
})(window);
