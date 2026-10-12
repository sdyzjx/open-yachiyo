/* Task canvas + chat bubbles (task 7). Plain DOM; positioned by body[data-pos] / config task_canvas.position. */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const STATUS_ICON = { running: '◔', done: '✓', failed: '✕', pending: '○' };

  function createCanvas({ root }) {
    const bubbles = el('div', 'tc-bubbles');
    const tasks = el('div', 'tc-tasks');
    root.append(bubbles, tasks);
    let assistant = null;
    let assistantText = '';
    let fadeTimer = null;
    const taskEls = new Map();

    function trim() { while (bubbles.children.length > 3) bubbles.firstChild.remove(); }

    function showUser(text) {
      if (!text) return;
      const b = el('div', 'tc-bubble tc-user', text);
      bubbles.appendChild(b);
      trim();
      assistant = null;
      assistantText = '';
      setTimeout(() => fade(b), 9000);
    }

    function fade(node) {
      node.classList.add('tc-out');
      setTimeout(() => node.remove(), 400);
    }

    function delta(text) {
      if (!text) return;
      clearTimeout(fadeTimer);
      if (!assistant) { assistant = el('div', 'tc-bubble tc-assistant'); bubbles.appendChild(assistant); trim(); assistantText = ''; }
      assistantText += text;
      assistant.textContent = assistantText;
    }

    function final(text) {
      if (text) {
        if (!assistant) { assistant = el('div', 'tc-bubble tc-assistant'); bubbles.appendChild(assistant); trim(); }
        assistant.textContent = String(text);
      }
      const node = assistant;
      assistant = null;
      assistantText = '';
      if (node) fadeTimer = setTimeout(() => fade(node), 14000);
    }

    function updateTask(t) {
      if (!t || !t.task_id) return;
      let card = taskEls.get(t.task_id);
      if (!card) {
        card = { root: el('div', 'tc-task'), title: el('div', 'tc-task-title'), steps: el('ul', 'tc-steps') };
        card.root.append(card.title, card.steps);
        tasks.appendChild(card.root);
        taskEls.set(t.task_id, card);
      }
      card.root.dataset.status = t.status || 'running';
      card.title.textContent = `${STATUS_ICON[t.status] || STATUS_ICON.running} ${t.title || t.task_id}`;
      card.steps.replaceChildren(...(t.steps || []).slice(-4).map((s) => el('li', `tc-step st-${s.status}`, `${STATUS_ICON[s.status] || '·'} ${s.name}`)));
      clearTimeout(card.timer);
      if (t.status === 'done' || t.status === 'failed') {
        card.timer = setTimeout(() => { fade(card.root); taskEls.delete(t.task_id); }, 8000);
      }
    }

    return { showUser, delta, final, updateTask, element: root };
  }

  global.YachiyoTaskCanvas = { createCanvas };
})(window);
