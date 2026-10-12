#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createArchive, MAX_FILES, MAX_EXPANDED_BYTES } = require('../apps/gateway/deviceHub/pluginArchive');

function packDirectory(directory) {
  const root = path.resolve(directory); const entries = new Map(); let total = 0;
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name); const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Plugin packages cannot contain symlinks or special files');
      if (stat.isDirectory()) walk(file);
      else {
        total += stat.size;
        if (total > MAX_EXPANDED_BYTES || entries.size >= MAX_FILES) throw new Error('Plugin package too large');
        entries.set(path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file));
      }
    }
  }
  walk(root);
  return createArchive(entries);
}
if (require.main === module) {
  try {
    const [directory, flag, output] = process.argv.slice(2);
    if (!directory || (flag && (flag !== '-o' || !output))) throw new Error('Usage: node scripts/plugin-pack.js <dir> [-o out.yplug]');
    const file = path.resolve(output || `${path.basename(path.resolve(directory))}.yplug`);
    if (file.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Output must be outside the source directory');
    fs.writeFileSync(file, packDirectory(directory)); console.log(file);
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { packDirectory };
