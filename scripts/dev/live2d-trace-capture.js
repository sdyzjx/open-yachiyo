#!/usr/bin/env node
'use strict';
// Capture the Live2D stage trace from a debug-build Android WebView over CDP.
//   adb -s <dev> forward tcp:9333 localabstract:webview_devtools_remote_<pid>
//   node scripts/dev/live2d-trace-capture.js --seconds 60 --out trace.json [--scenario idle|actions]
// The page must expose window.__yachiyoStage (stage.js). Tracing is off in normal use.
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const port = Number(opt('port', 9333));
const seconds = Number(opt('seconds', 60));
const out = opt('out', 'trace.json');
const scenario = opt('scenario', 'idle');

function getJson(url) {
  return new Promise((resolve, reject) => http.get(url, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject));
}

(async () => {
  const pages = await getJson(`http://127.0.0.1:${port}/json`);
  const page = pages.find((p) => p.type === 'page' && /index\.html|appassets|localhost/.test(p.url)) || pages.find((p) => p.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const waiting = new Map();
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  const evalJs = (expression) => new Promise((resolve, reject) => {
    const myId = ++id; waiting.set(myId, (d) => (d.result && d.result.exceptionDetails ? reject(new Error(JSON.stringify(d.result.exceptionDetails))) : resolve(d.result && d.result.result && d.result.result.value)));
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (action, dur, policy = 'replace') => evalJs(`window.__yachiyoNative.dispatch({type:'hub.event',data:{topic:'ui.live2d.action',data:${JSON.stringify({ action, duration_sec: dur, queue_policy: policy })},from:'gateway'}}),1`);

  await evalJs('window.__yachiyoStage.startTrace()');
  const t0 = Date.now();
  if (scenario === 'actions') {
    const seq = [
      [{ type: 'motion', name: 'Greet', args: { group: 'Greet', index: 0 } }, 3],
      [{ type: 'emote', name: 'happy' }, 3],
      [{ type: 'emote', name: 'sad' }, 3],
      [{ type: 'motion', name: 'ReactError', args: { group: 'ReactError', index: 0 } }, 3],
      [{ type: 'gesture', name: 'nod' }, 2],
      [{ type: 'react', name: 'thinking' }, 3]
    ];
    for (const [a, d] of seq) { try { await fire(a, d); } catch (e) { console.error('fire failed', e.message); } await sleep((d + 2.5) * 1000); }
  }
  while (Date.now() - t0 < seconds * 1000) await sleep(500);
  const trace = await evalJs('JSON.stringify(window.__yachiyoStage.stopTrace())');
  fs.writeFileSync(out, trace);
  console.log(`wrote ${out} (${(trace.length / 1024).toFixed(0)} KiB)`);
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
