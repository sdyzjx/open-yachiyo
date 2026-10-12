#!/usr/bin/env node
'use strict';

/**
 * Generates apps/android/app/src/main/assets/generated/ (contract C6) and
 * optionally serves the assets root for browser / device debugging.
 *
 *   node scripts/android-sync-assets.js            # sync everything
 *   node scripts/android-sync-assets.js --serve    # sync, then serve on :8790
 *   node scripts/android-sync-assets.js --serve-only --port 8790
 *
 * See docs/plans/PLAN-android-ws5-web-ui.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'apps/android/app/src/main/assets');
const GENERATED = path.join(ASSETS, 'generated');
const SAMPLE_PLUGINS = path.join(ROOT, 'apps/android/sample-plugins');
const CACHE_DIR = path.join(os.homedir(), '.cache', 'yachiyo');
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const TEXTURE_SIZES = [4096, 2048];
const SHARED_FILES = [
  ['apps/desktop-live2d/shared/live2dActionMessage.js', 'live2dActionMessage.js'],
  ['apps/desktop-live2d/renderer/live2dActionMutex.js', 'live2dActionMutex.js'],
  ['apps/desktop-live2d/renderer/live2dActionQueuePlayer.js', 'live2dActionQueuePlayer.js'],
  ['apps/desktop-live2d/renderer/live2dActionExecutor.js', 'live2dActionExecutor.js'],
  ['apps/desktop-live2d/renderer/lipsyncViseme.js', 'lipsyncViseme.js'],
  ['apps/desktop-live2d/renderer/lipsyncMouthTransition.js', 'lipsyncMouthTransition.js'],
  ['apps/desktop-live2d/renderer/realtimeVoicePlayer.js', 'realtimeVoicePlayer.js'],
  ['apps/desktop-live2d/shared/theme/yachiyo-theme.css', 'yachiyo-theme.css']
];

function log(msg) { console.log(`[android-sync] ${msg}`); }
function warn(msg) { console.warn(`[android-sync] WARN ${msg}`); }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function ensureCubismCore() {
  ensureDir(CACHE_DIR);
  const cached = path.join(CACHE_DIR, 'live2dcubismcore.min.js');
  if (!fs.existsSync(cached) || fs.statSync(cached).size < 10000) {
    log(`downloading Cubism Core from ${CORE_URL}`);
    try {
      await download(CORE_URL, cached);
    } catch (err) {
      throw new Error(
        `Cannot download Cubism Core (${err.message}).\n`
        + `  Download it manually from ${CORE_URL}\n`
        + `  and save it as ${cached}, then re-run this script.`
      );
    }
  }
  return cached;
}

/** Returns a function (src, dest, size) => boolean using the best available tool. */
function pickResizer() {
  const has = (cmd) => spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;
  if (process.platform === 'darwin' && has('sips')) {
    return (src, dest, size) => {
      const r = spawnSync('sips', ['-Z', String(size), src, '--out', dest], { encoding: 'utf8' });
      return r.status === 0;
    };
  }
  const magick = has('magick') ? 'magick' : (has('convert') ? 'convert' : null);
  if (magick) {
    return (src, dest, size) => {
      const r = spawnSync(magick, [src, '-resize', `${size}x${size}>`, dest], { encoding: 'utf8' });
      return r.status === 0;
    };
  }
  return null;
}

function readPngSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function syncModel(modelDirName, resizer) {
  const srcDir = path.join(ROOT, 'assets/live2d', modelDirName);
  if (!fs.existsSync(srcDir)) throw new Error(`model dir not found: ${srcDir}`);
  const modelFile = fs.readdirSync(srcDir).find((f) => f.endsWith('.model3.json'));
  if (!modelFile) throw new Error(`no .model3.json in ${srcDir}`);
  const model = JSON.parse(fs.readFileSync(path.join(srcDir, modelFile), 'utf8'));
  const refs = model.FileReferences || {};
  const result = { name: modelDirName, variants: {} };

  for (const size of TEXTURE_SIZES) {
    const outDir = path.join(GENERATED, 'model', String(size));
    fs.rmSync(outDir, { recursive: true, force: true });
    ensureDir(outDir);
    const out = JSON.parse(JSON.stringify(model));
    const o = out.FileReferences;

    // ASCII file names so URLs stay trivially safe in WebViewAssetLoader.
    if (refs.Moc) { copyFile(path.join(srcDir, refs.Moc), path.join(outDir, 'model.moc3')); o.Moc = 'model.moc3'; }
    if (refs.Physics) { copyFile(path.join(srcDir, refs.Physics), path.join(outDir, 'model.physics3.json')); o.Physics = 'model.physics3.json'; }
    if (refs.DisplayInfo) { copyFile(path.join(srcDir, refs.DisplayInfo), path.join(outDir, 'model.cdi3.json')); o.DisplayInfo = 'model.cdi3.json'; }
    if (Array.isArray(refs.Expressions)) {
      o.Expressions = refs.Expressions.map((exp, i) => {
        const name = `exp_${i}.exp3.json`;
        copyFile(path.join(srcDir, exp.File), path.join(outDir, name));
        return { ...exp, File: name };
      });
    }
    if (refs.Motions) {
      for (const [group, list] of Object.entries(refs.Motions)) {
        o.Motions[group] = list.map((m, i) => {
          const name = `motions/${group.toLowerCase()}_${i}.motion3.json`;
          copyFile(path.join(srcDir, m.File), path.join(outDir, name));
          return { ...m, File: name };
        });
      }
    }
    o.Textures = (refs.Textures || []).map((tex, i) => {
      const dest = path.join(outDir, `textures/texture_${String(i).padStart(2, '0')}.png`);
      ensureDir(path.dirname(dest));
      const src = path.join(srcDir, tex);
      const { w } = readPngSize(src);
      let done = false;
      if (w > size) {
        if (resizer) done = resizer(src, dest, size);
        if (!done) warn(`could not resize ${tex} to ${size}; copying original (${w}px) - will crash low-end GPUs`);
      } else {
        done = false;
      }
      if (!done) copyFile(src, dest);
      return `textures/texture_${String(i).padStart(2, '0')}.png`;
    });
    fs.writeFileSync(path.join(outDir, 'model.model3.json'), `${JSON.stringify(out, null, 2)}\n`);
    result.variants[size] = `model/${size}/model.model3.json`;
    log(`model ${modelDirName} @${size} ready`);
  }
  return result;
}

function syncPresets() {
  try {
    const YAML = require('yaml');
    const src = path.join(ROOT, 'config/live2d-presets.yaml');
    const data = YAML.parse(fs.readFileSync(src, 'utf8'));
    const dest = path.join(GENERATED, 'config/live2d-presets.json');
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, JSON.stringify(data));
    return true;
  } catch (err) {
    warn(`live2d presets not generated: ${err.message}`);
    return false;
  }
}

async function sync(opts) {
  ensureDir(GENERATED);
  const core = await ensureCubismCore();
  copyFile(core, path.join(GENERATED, 'lib/live2dcubismcore.min.js'));
  copyFile(path.join(ROOT, 'node_modules/pixi.js/dist/browser/pixi.min.js'), path.join(GENERATED, 'lib/pixi.min.js'));
  copyFile(path.join(ROOT, 'node_modules/pixi-live2d-display/dist/cubism4.min.js'), path.join(GENERATED, 'lib/cubism4.min.js'));
  for (const [from, to] of SHARED_FILES) copyFile(path.join(ROOT, from), path.join(GENERATED, 'shared', to));
  const presets = syncPresets();

  const resizer = pickResizer();
  if (!resizer) warn('no image tool (sips/magick/convert) found; textures are copied at original size');
  const model = opts.skipModel ? null : syncModel(opts.model, resizer);

  const manifest = {
    generated_at: new Date().toISOString(),
    model,
    texture_sizes: TEXTURE_SIZES,
    presets: presets ? 'config/live2d-presets.json' : null,
    lib: ['lib/pixi.min.js', 'lib/live2dcubismcore.min.js', 'lib/cubism4.min.js'],
    shared: SHARED_FILES.map(([, to]) => `shared/${to}`)
  };
  fs.writeFileSync(path.join(GENERATED, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`done -> ${GENERATED}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.moc3': 'application/octet-stream', '.wav': 'audio/wav', '.mp3': 'audio/mpeg'
};

function listSamplePlugins() {
  if (!fs.existsSync(SAMPLE_PLUGINS)) return [];
  return fs.readdirSync(SAMPLE_PLUGINS)
    .map((d) => path.join(SAMPLE_PLUGINS, d, 'manifest.json'))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

/** Mirrors the WebViewAssetLoader mapping of contract C6. */
function resolveRequest(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.startsWith('/sdk/')) return path.join(ASSETS, 'web/sdk', p.slice(5));
  if (p.startsWith('/plugins/')) {
    const [, , id, ...rest] = p.split('/');
    const dir = fs.readdirSync(SAMPLE_PLUGINS).find((d) => {
      try { return JSON.parse(fs.readFileSync(path.join(SAMPLE_PLUGINS, d, 'manifest.json'), 'utf8')).id === id; } catch { return false; }
    });
    return dir ? path.join(SAMPLE_PLUGINS, dir, rest.join('/')) : null;
  }
  return path.join(ASSETS, p);
}

function serve(port) {
  const server = http.createServer((req, res) => {
    const urlPath = req.url || '/';
    if (urlPath.startsWith('/__dev/plugins')) {
      const list = listSamplePlugins().map((m) => ({ ...m, base_url: `/plugins/${m.id}/`, installed_at: Date.now(), enabled: true }));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(list));
      return;
    }
    let file = null;
    try { file = resolveRequest(urlPath === '/' ? '/web/index.html' : urlPath); } catch { file = null; }
    if (!file || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '0.0.0.0', () => log(`serving ${ASSETS} on http://0.0.0.0:${port}/web/index.html`));
}

function parseArgs(argv) {
  const opts = { serve: false, serveOnly: false, port: 8790, model: 'yachiyo-kaguya', skipModel: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--serve') opts.serve = true;
    else if (a === '--serve-only') opts.serveOnly = true;
    else if (a === '--port') opts.port = Number(argv[++i]) || 8790;
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--skip-model') opts.skipModel = true;
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  (async () => {
    if (!opts.serveOnly) await sync(opts);
    if (opts.serve || opts.serveOnly) serve(opts.port);
  })().catch((err) => {
    console.error(`[android-sync] ERROR ${err.message}`);
    process.exit(1);
  });
}

module.exports = { resolveRequest, parseArgs, TEXTURE_SIZES, SHARED_FILES };
