'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '../../apps/android/app/src/main/assets/web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

function fakeDom() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.textContent = ''; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.listeners = {}; this.isConnected = true; this.offsetWidth = 0; this.dataset = {};
      this.style = { setProperty(k, v) { this[k] = v; } };
      const set = new Set(); this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); } }; this.set = set; }
    append(...n) { this.children.push(...n); }
    appendChild(n) { this.children.push(n); return n; }
    get firstChild() { return this.children[0]; }
    remove() { this.isConnected = false; }
    replaceChildren(...n) { this.children = n; }
    addEventListener(t, fn) { this.listeners[t] = fn; }
    dispatch(t) { this.listeners[t] && this.listeners[t](); }
  }
  // children arrays double as DOM collections; give them the needed `length`
  return { createElement: (t) => { const n = new Node(t); Object.defineProperty(n.children, 'remove', { value: () => {} }); return n; } };
}

function load() {
  const raf = [];
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const setTimeoutFake = (fn, delay = 0) => {
    const id = nextTimer++;
    timers.set(id, { fn, at: now + Number(delay || 0) });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = end;
  };
  const g = { document: fakeDom(), requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; }, YachiyoLayout: require(path.join(WEB, 'js/layout.js')) };
  const src = read('js/canvas.js');
  new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', src)(
    g, g.document, g.requestAnimationFrame, setTimeoutFake, clearTimeoutFake
  );
  return { api: g.YachiyoTaskCanvas, raf, advance, flush: () => { while (raf.length) raf.shift()(); } };
}

test('new messages pin the scroller to the bottom until the user scrolls up', () => {
  const { api, flush } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });
  const scroll = canvas.scrollEl;
  scroll.scrollHeight = 1000; scroll.clientHeight = 300;
  canvas.delta('你好');
  flush();
  assert.equal(scroll.scrollTop, 1000);
  scroll.scrollTop = 100; scroll.dispatch('scroll'); // reader scrolled up
  assert.equal(canvas.stuck, false);
  scroll.scrollHeight = 1400;
  canvas.delta('更多内容');
  flush();
  assert.equal(scroll.scrollTop, 100);
  canvas.showUser('我发一条');
  flush();
  assert.equal(scroll.scrollTop, 1400); // sending always jumps to newest
  assert.ok(root.classList.contains('has-content'));
});

test('landscape agent and user lanes scroll and pin independently', () => {
  const { api, flush } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });
  canvas.agentScrollEl.scrollHeight = 900; canvas.agentScrollEl.clientHeight = 250;
  canvas.userScrollEl.scrollHeight = 700; canvas.userScrollEl.clientHeight = 250;
  canvas.delta('八千代回答');
  flush();
  assert.equal(canvas.agentScrollEl.scrollTop, 900);
  assert.equal(canvas.userScrollEl.scrollTop, 0);
  canvas.agentScrollEl.scrollTop = 100;
  canvas.agentScrollEl.dispatch('scroll');
  canvas.agentScrollEl.scrollHeight = 1200;
  canvas.delta('继续回答');
  flush();
  assert.equal(canvas.agentScrollEl.scrollTop, 100);
  canvas.showUser('用户消息');
  flush();
  assert.equal(canvas.userScrollEl.scrollTop, 700);
  assert.equal(canvas.agentStuck, false);
  assert.equal(canvas.userStuck, true);
});

test('assistant bubbles are trace-aware and duplicate final events are idempotent', () => {
  const { api } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });
  const bubbles = canvas.mergedScrollEl.children[0];
  canvas.delta('甲', { trace_id: 'trace-a' });
  canvas.delta('乙', { trace_id: 'trace-b' });
  canvas.delta('一', { trace_id: 'trace-a' });
  canvas.final('甲一', { trace_id: 'trace-a' });
  canvas.final('甲一', { trace_id: 'trace-a' });
  canvas.delta('二', { trace_id: 'trace-b' });
  canvas.final('乙二', { trace_id: 'trace-b' });
  assert.deepEqual(bubbles.children.map((node) => node.textContent), ['甲一', '乙二']);
});

test('a newer streamed reply does not cancel an older bubble fade timer', () => {
  const { api, advance } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });
  const bubbles = canvas.mergedScrollEl.children[0];

  canvas.delta('旧', { trace_id: 'trace-old' });
  canvas.final('旧', { trace_id: 'trace-old' });
  const oldBubble = bubbles.children[0];
  canvas.delta('新回答正在生成', { trace_id: 'trace-new' });

  advance(16090);
  assert.equal(oldBubble.classList.contains('tc-out'), true);
  advance(420);
  assert.equal(oldBubble.isConnected, false);
  assert.equal(bubbles.children[1].isConnected, true);
  assert.equal(root.classList.contains('has-content'), true);
});

test('an interrupted assistant stream expires after 30 seconds without a final event', () => {
  const { api, advance } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });
  const bubbles = canvas.mergedScrollEl.children[0];

  canvas.delta('新回答仍在生成', { trace_id: 'trace-stale' });
  const bubble = bubbles.children[0];
  advance(29999);
  assert.equal(bubble.classList.contains('tc-out'), false);

  canvas.delta('中', { trace_id: 'trace-stale' });
  advance(29999);
  assert.equal(bubble.classList.contains('tc-out'), false);
  advance(1);
  assert.equal(bubble.classList.contains('tc-out'), true);
  advance(420);
  assert.equal(bubble.isConnected, false);
  assert.equal(root.classList.contains('has-content'), false);
});

test('repeated task failures are compacted into one counted row', () => {
  const { api } = load();
  const root = fakeDom().createElement('section');
  const canvas = api.createCanvas({ root });

  canvas.updateTask({
    task_id: 'task-retries', status: 'failed', title: '执行电脑操作',
    steps: [
      { name: 'shell.exec', status: 'failed' },
      { name: 'live2d.gesture', status: 'done' },
      { name: 'shell.exec', status: 'failed' },
      { name: 'shell.exec', status: 'failed' }
    ]
  });

  const task = canvas.mergedScrollEl.children[1].children[0];
  assert.deepEqual(task.children[1].children.map((node) => node.textContent), [
    '✓ live2d.gesture',
    '✕ shell.exec ×3'
  ]);
});

test('chat panel is a bounded scroller that does not feed the stage swipe gestures', () => {
  const css = read('css/app.css');
  assert.match(css, /\.chat-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.chat-scroll\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.chat-scroll\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.match(css, /\.tc-bubble, \.tc-task\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.match(css, /\.chat-scroll\s*\{[^}]*position:\s*absolute/s);
  assert.match(read('js/canvas.js'), /style\.height = `\$\{layout\.height\}px`/);
  const app = read('js/app.js');
  assert.match(app, /const IGNORE = '[^']*\.chat-scroll[^']*\.tc-bubble[^']*\.tc-task/);
  assert.match(app, /L\.modelScreenBounds\(/);
  assert.match(app, /L\.computeChatPanelLayout\(/);
  assert.match(app, /L\.computeChatSplitLayout\(/);
  assert.match(app, /L\.interpolateSplitChatLayout\(/);
});

test('keyboard (B8): native ime event only moves the input bar and chat panel, never the stage', () => {
  const app = read('js/app.js');
  const body = app.slice(app.indexOf('function onIme'), app.indexOf("B.on('ime', onIme)"));
  assert.match(body, /setProperty\('--ime'/);
  assert.doesNotMatch(body, /cam\.|stage\.|retargetCamera|resize\(/);
  const css = read('css/app.css');
  assert.match(css, /\.chat-form\s*\{[^}]*bottom:\s*[^;]*var\(--ime\)/s);
  assert.match(app, /S\.ime\.css/);
  assert.doesNotMatch(css, /#stage\s*\{[^}]*--ime/s);
  const manifest = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/AndroidManifest.xml'), 'utf8');
  const main = manifest.slice(manifest.indexOf('.MainActivity'), manifest.indexOf('.LockscreenActivity'));
  assert.match(main, /windowSoftInputMode="adjustNothing"/);
  assert.match(manifest.slice(manifest.indexOf('.LockscreenActivity'), manifest.indexOf('.SettingsActivity')), /windowSoftInputMode="adjustNothing"/);
  const activity = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/java/com/yachiyo/companion/WebHostActivity.kt'), 'utf8');
  const listener = activity.slice(activity.indexOf('ViewCompat.setOnApplyWindowInsetsListener'), activity.indexOf('decor.viewTreeObserver'));
  assert.match(listener, /WindowInsetsCompat\.Type\.ime\(\)/);
  assert.doesNotMatch(listener, /ViewCompat\.onApplyWindowInsets/);
});
