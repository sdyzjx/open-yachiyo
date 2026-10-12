#!/usr/bin/env node
'use strict';
// Analyse a stage trace (see live2d-trace-capture.js): per-parameter max per-frame delta, max per-second
// velocity, dt statistics and the worst discontinuities with surrounding motion state.
//   node scripts/dev/live2d-trace-analyze.js trace.json [--top 5] [--json]
const fs = require('node:fs');

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
  return { p50: pct(0.5), p95: pct(0.95), max: sorted.length ? sorted[sorted.length - 1] : 0 };
}

function analyze(trace, { top = 5 } = {}) {
  const params = Array.isArray(trace.params) ? trace.params : [];
  const rows = Array.isArray(trace.rows) ? trace.rows : [];
  const events = Array.isArray(trace.events) ? trace.events : [];
  const perParam = {};
  params.forEach((name, k) => {
    let maxDelta = 0; let maxVel = 0; const jumps = [];
    for (let i = 1; i < rows.length; i += 1) {
      if (!Number.isFinite(rows[i].v?.[k]) || !Number.isFinite(rows[i - 1].v?.[k])) continue;
      const d = Math.abs(rows[i].v[k] - rows[i - 1].v[k]);
      const wall = Math.max(1, rows[i].t - rows[i - 1].t);
      const vel = d / wall * 1000;
      if (d > maxDelta) maxDelta = d;
      if (vel > maxVel) maxVel = vel;
      jumps.push({ i, t: rows[i].t, delta: d, vel, dt: rows[i].dt, grp: rows[i].grp });
    }
    jumps.sort((a, b) => b.vel - a.vel);
    perParam[name] = { maxDelta, maxVelPerSec: maxVel, worst: jumps.slice(0, top) };
  });
  return {
    version: trace.version || 1,
    frames: rows.length,
    durationSec: rows.length ? (rows[rows.length - 1].t - rows[0].t) / 1000 : 0,
    dtMs: summarize(rows.map((r) => r.dt)),
    rawDtMs: summarize(rows.map((r) => r.raw)),
    physicsDtMs: summarize(rows.map((r) => Number.isFinite(r.physicsDt) ? r.physicsDt : r.dt)),
    clampedFrames: rows.filter((r) => r.clamped).length,
    motionTransitions: events.filter((event) => event.type === 'motionState'),
    parameterWrites: events.filter((event) => event.type === 'setParam' || event.type === 'releaseParams'),
    events: events.length,
    perParam
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: live2d-trace-analyze.js trace.json [--top N] [--json]'); process.exit(2); }
  const topIdx = process.argv.indexOf('--top');
  const r = analyze(JSON.parse(fs.readFileSync(file, 'utf8')), { top: topIdx > 0 ? Number(process.argv[topIdx + 1]) : 5 });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`frames=${r.frames} duration=${r.durationSec.toFixed(1)}s dt(ms) p50=${r.dtMs.p50.toFixed(1)} p95=${r.dtMs.p95.toFixed(1)} max=${r.dtMs.max.toFixed(1)} clamped=${r.clampedFrames} events=${r.events}`);
    for (const [name, p] of Object.entries(r.perParam)) {
      console.log(`${name.padEnd(14)} maxDelta/frame=${p.maxDelta.toFixed(4)} maxVel=${p.maxVelPerSec.toFixed(3)}/s`);
      for (const w of p.worst.slice(0, 3)) console.log(`    t=${(w.t / 1000).toFixed(2)}s delta=${w.delta.toFixed(4)} vel=${w.vel.toFixed(2)}/s dt=${w.dt.toFixed(0)}ms motion=${w.grp}`);
    }
  }
}

module.exports = { analyze };
