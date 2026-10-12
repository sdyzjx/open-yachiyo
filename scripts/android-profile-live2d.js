#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(snapshot, hostElapsedMs, mode) {
  const elapsedMs = Number(snapshot.elapsedMs) > 0 ? Number(snapshot.elapsedMs) : hostElapsedMs;
  const seconds = elapsedMs / 1000;
  const frames = snapshot.frameIntervals || [];
  const draws = snapshot.drawSamples || [];
  const workers = snapshot.workerSamples || [];
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const timing = (values) => ({
    meanMs: mean(values),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : 0,
    over16_7Ms: values.filter((value) => value > 16.7).length,
    over33_3Ms: values.filter((value) => value > 33.3).length
  });
  return {
    mode,
    elapsedMs,
    hostElapsedMs,
    raf: { frames: snapshot.rafFrames, fps: snapshot.rafFrames / seconds, ...timing(frames) },
    draw: { frames: snapshot.drawFrames, fps: snapshot.drawFrames / seconds, ...timing(draws) },
    worker: {
      frames: snapshot.workerFrames, fps: snapshot.workerFrames / seconds,
      meanMs: mean(workers), p95Ms: percentile(workers, 0.95),
      ready: snapshot.workerReady, active: snapshot.workerActive, failed: snapshot.workerFailed
    },
    gl: snapshot.gl || null
  };
}

function parseArgs(argv) {
  const options = { port: 0, durationMs: 5000, swipe: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--duration') options.durationMs = Number(argv[++i]) * 1000;
    else if (argv[i] === '--swipe') options.swipe = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port is required (1-65535)');
  if (!Number.isFinite(options.durationMs) || options.durationMs < 1000) throw new Error('--duration must be at least 1 second');
  return options;
}

async function discover(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP discovery failed: HTTP ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('no debuggable page target');
  return target.webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.once('error', reject);
    socket.once('open', () => {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (!message.id || !pending.has(message.id)) return;
        const { resolve: done, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else done(message.result);
      });
      resolve({
        call(method, params = {}) {
          const requestId = ++id;
          return new Promise((done, fail) => {
            pending.set(requestId, { resolve: done, reject: fail });
            socket.send(JSON.stringify({ id: requestId, method, params }));
          });
        },
        close() { socket.close(); }
      });
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function swipe(client, fromX, toX, y) {
  await client.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  const steps = 18;
  for (let i = 1; i <= steps; i += 1) {
    const x = fromX + (toX - fromX) * i / steps;
    await client.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await wait(16);
  }
  await client.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = await connect(await discover(options.port));
  try {
    const dimensions = await client.call('Runtime.evaluate', { expression: '({width: innerWidth, height: innerHeight})', returnByValue: true });
    const size = dimensions.result.value;
    const begun = await client.call('Runtime.evaluate', {
      expression: 'Boolean(window.__yachiyoPerf && (window.__yachiyoPerf.begin(), true))', returnByValue: true
    });
    if (!begun.result.value) throw new Error('performance sampling hook is unavailable');

    const started = Date.now();
    if (options.swipe) {
      let reverse = false;
      while (Date.now() - started < options.durationMs - 400) {
        const left = size.width * 0.2;
        const right = size.width * 0.8;
        await swipe(client, reverse ? left : right, reverse ? right : left, size.height * 0.55);
        reverse = !reverse;
        await wait(80);
      }
    } else {
      await wait(options.durationMs);
    }
    const elapsedMs = Date.now() - started;
    const result = await client.call('Runtime.evaluate', {
      expression: 'window.__yachiyoPerf.snapshot()', returnByValue: true
    });
    process.stdout.write(`${JSON.stringify(summarize(result.result.value, elapsedMs, options.swipe ? 'continuous-swipe' : 'idle'), null, 2)}\n`);
  } finally {
    client.close();
  }
}

module.exports = { percentile, summarize, parseArgs };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
