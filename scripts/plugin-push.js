#!/usr/bin/env node
const fs = require('node:fs');
const { packDirectory } = require('./plugin-pack');
const { readArchive } = require('../apps/gateway/deviceHub/pluginArchive');

async function pushPlugin(source, { target, gateway = 'http://localhost:3000', token = process.env.DEVICE_HUB_TOKEN || '', fetchImpl = fetch } = {}) {
  const archive = fs.statSync(source).isDirectory() ? packDirectory(source) : fs.readFileSync(source);
  readArchive(archive);
  async function request(route, options = {}) {
    const response = await fetchImpl(new URL(route, gateway), { ...options, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }, signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
    return result;
  }
  const uploaded = await request('/api/device/plugins', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: archive });
  const pushed = await request(`/api/device/plugins/${uploaded.sha256}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) });
  return { ...uploaded, ...pushed };
}
if (require.main === module) {
  const [source, ...args] = process.argv.slice(2); const options = {};
  try {
    if (!source) throw new Error('Usage: node scripts/plugin-push.js <dir|file.yplug> [--target id] [--gateway URL]');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--target', '--gateway'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid option');
      options[args[i].slice(2)] = args[i + 1];
    }
    pushPlugin(source, options).then((result) => console.log(JSON.stringify(result, null, 2))).catch((err) => { console.error(err.message); process.exitCode = 1; });
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { pushPlugin };
