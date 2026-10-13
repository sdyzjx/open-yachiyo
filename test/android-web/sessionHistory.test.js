const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../apps/android/app/src/main/assets/web');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const history = fs.readFileSync(path.join(root, 'js/sessionHistory.js'), 'utf8');
const markdown = fs.readFileSync(path.join(root, 'js/markdown.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');

test('TC-AWB-052 top-edge pull opens a responsive session history panel', () => {
  assert.match(html, /id="session-history-panel"/);
  assert.match(html, /id="session-history-list"/);
  assert.match(html, /id="session-history-messages"/);
  assert.match(app, /historyPullLimit = clamp\(S\.view\.h \* \.22, 104, 168\)/);
  assert.match(app, /press\.fromHistoryZone && r\.axis === 'y' && r\.dy > 0/);
  assert.match(app, /\.chat-scroll,.tc-bubble,.tc-task/);
  assert.match(app, /sessionHistory\.beginPull\(\{ startY: press\.y, followPointer: true \}\)/);
  assert.match(app, /sessionHistory\.updatePull\(e\.clientY\)/);
  assert.match(css, /\.session-history-panel\.open/);
  assert.match(css, /\.session-history-panel\[data-landscape="1"\] \.session-history-body/);
});

test('TC-AWB-053 session history uses server RPC and filters live events to the selected session', () => {
  assert.match(history, /bridge\.rpc\('session\.list'/);
  assert.match(history, /bridge\.rpc\('session\.history'/);
  assert.match(history, /bridge\.rpc\('session\.select'/);
  assert.match(history, /bridge\.rpc\('session\.create'/);
  assert.match(app, /sessionHistory\.accepts\(d\?\.session_id\)/);
  assert.match(app, /taskCanvasApi\.clear\(\)/);
});

test('TC-AWB-055 history panel opens as a preview and expands to an edge-to-edge full screen', () => {
  assert.match(history, /state = \{ open: false, mode: 'closed'/);
  assert.match(history, /if \(state\.mode === 'peek'\) setMode\('full'\)/);
  const sandbox = { innerHeight: 640, innerWidth: 360 };
  new Function('window', history)(sandbox);
  assert.equal(sandbox.YachiyoSessionHistory.resolvePullRelease({ edge: 319, viewportHeight: 640, direction: 'down' }), 'peek');
  assert.equal(sandbox.YachiyoSessionHistory.resolvePullRelease({ edge: 321, viewportHeight: 640, direction: 'down' }), 'full');
  assert.equal(sandbox.YachiyoSessionHistory.resolvePullRelease({ edge: 321, viewportHeight: 640, direction: 'up' }), 'peek');
  assert.equal(sandbox.YachiyoSessionHistory.resolvePullRelease({ edge: 319, viewportHeight: 640, direction: 'up' }), 'closed');
  assert.match(history, /--history-drag-height/);
  assert.match(history, /panel\.classList\.add\('open', 'dragging'\)/);
  assert.match(history, /event\.target === backdrop && state\.mode === 'peek'/);
  assert.match(history, /\.session-history-list,.session-history-messages,.session-history-composer/);
  assert.match(css, /\.session-history-panel\[data-state="full"\] \{ height: 100%; border-radius: 0;/);
  assert.match(css, /\.session-history-panel\[data-landscape="1"\]\[data-state="full"\] \{ height: 100%;/);
  assert.match(css, /height: var\(--history-drag-height, min\(50vh, 520px\)\)/);
  assert.match(css, /\.session-history-panel\.dragging/);
  assert.match(css, /grid-template-rows: 62px minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: minmax\(154px, 23%\) minmax\(0, 1fr\)/);
  assert.match(css, /\.session-history-panel\[data-landscape="1"\] \{ height: var\(--history-drag-height, min\(82vh, 500px\)\);/);
  assert.match(css, /\.session-history-panel\[data-landscape="1"\] \.session-history-status \{ display: none;/);
  assert.match(history, /function onOrientationChange\(landscape\)/);
  assert.match(app, /sessionHistory\?\.onOrientationChange\(S\.landscape\)/);
  assert.match(css, /@keyframes session-history-reflow/);
});

test('TC-AWB-056 history messages render safe Markdown and provide an in-session composer', () => {
  const sandbox = {};
  new Function('window', markdown)(sandbox);
  const rendered = sandbox.YachiyoMarkdown.render([
    '# 标题', '', '- **完成**', '- [文档](https://example.com)', '',
    '| 项目 | 状态 |', '| --- | --- |', '| 会话 | `active` |', '',
    '<script>alert(1)</script> [危险](javascript:alert(1))'
  ].join('\n'));
  assert.match(rendered, /<h1>标题<\/h1>/);
  assert.match(rendered, /<ul><li><strong>完成<\/strong><\/li>/);
  assert.match(rendered, /href="https:\/\/example\.com"/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /<code>active<\/code>/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /href="javascript:/);
  assert.match(html, /id="session-history-composer"/);
  assert.match(html, /id="session-history-input"/);
  assert.match(html, /class="session-history-bottom-grip"/);
  assert.match(css, /\.session-history-bottom-grip \{[^}]*touch-action: none/);
  assert.match(history, /onSend\?\.\(text, state\.currentId\)/);
  assert.match(app, /onSend: \(text\) => submitChatText\(text\)/);
});
