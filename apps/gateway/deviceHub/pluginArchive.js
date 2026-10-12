const { deflateRawSync, inflateRawSync } = require('node:zlib');
const { fault } = require('./hub');
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 2048;
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 512 && !/[\\:\x00-\x1f]/.test(name) && !name.startsWith('/') && name.replace(/\/$/, '').split('/').every((part) => part && part !== '.' && part !== '..');
}
function validateManifest(manifest, entries) {
  if (!manifest || !/^[a-z0-9._-]{3,64}$/.test(manifest.id || '') || manifest.id.includes('..') || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 128 || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version || '') || !['app', 'widget'].includes(manifest.type) || manifest.sdk !== 1) throw fault(-32602, 'Invalid plugin manifest');
  const entry = manifest.entry || 'index.html';
  if (!safePath(entry) || !entries.has(entry) || entry.endsWith('/')) throw fault(-32602, 'Missing or unsafe plugin entry');
  if (manifest.icon && (!safePath(manifest.icon) || !entries.has(manifest.icon))) throw fault(-32602, 'Missing or unsafe icon');
  if (manifest.permissions && (!Array.isArray(manifest.permissions) || !manifest.permissions.every((p) => typeof p === 'string' && /^(bus\.(publish|subscribe):[\w.*-]+|rpc\.call:[\w.*-]+|rpc\.register|agent\.tool)$/.test(p)))) throw fault(-32602, 'Invalid plugin permissions');
  if (manifest.type === 'widget') {
    const w = manifest.widget;
    if (!w || !['w', 'h', 'min_w', 'min_h', 'max_w', 'max_h'].every((key) => Number.isInteger(w[key]) && w[key] >= 1 && w[key] <= 4) || w.min_w > w.w || w.w > w.max_w || w.min_h > w.h || w.h > w.max_h) throw fault(-32602, 'Invalid widget dimensions');
  }
  return { ...manifest, entry };
}
function readArchive(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_ZIP_BYTES) throw new Error('ZIP size invalid');
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
    }
    if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('Multi-disk or invalid ZIP');
    const count = buffer.readUInt16LE(end + 10);
    const centralSize = buffer.readUInt32LE(end + 12);
    const centralOffset = buffer.readUInt32LE(end + 16);
    if (!count || count > MAX_FILES || count !== buffer.readUInt16LE(end + 8) || centralOffset + centralSize !== end) throw new Error('Invalid ZIP directory');
    const entries = new Map(); const ranges = []; let offset = centralOffset; let total = 0;
    for (let n = 0; n < count; n++) {
      if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry');
      const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10);
      const crc = buffer.readUInt32LE(offset + 16); const compressed = buffer.readUInt32LE(offset + 20); const size = buffer.readUInt32LE(offset + 24);
      const nameLen = buffer.readUInt16LE(offset + 28); const extraLen = buffer.readUInt16LE(offset + 30); const commentLen = buffer.readUInt16LE(offset + 32);
      const local = buffer.readUInt32LE(offset + 42);
      const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
      const unixType = (buffer.readUInt32LE(offset + 38) >>> 16) & 0xf000;
      total += size;
      if ((flags & ~0x808) || ![0, 8].includes(method) || !safePath(name) || entries.has(name) || total > MAX_EXPANDED_BYTES || (unixType && unixType !== 0x8000 && unixType !== 0x4000) || buffer.readUInt16LE(offset + 34)) throw new Error('Unsafe or unsupported ZIP entry');
      offset += 46 + nameLen + extraLen + commentLen;
      if (offset > end || local + 30 > centralOffset || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) throw new Error('Invalid local ZIP header');
      if (!(flags & 8) && (buffer.readUInt32LE(local + 14) !== crc || buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== size)) throw new Error('Conflicting ZIP sizes');
      const localNameLen = buffer.readUInt16LE(local + 26); const localExtraLen = buffer.readUInt16LE(local + 28);
      const start = local + 30 + localNameLen + localExtraLen;
      if (buffer.subarray(local + 30, local + 30 + localNameLen).toString('utf8') !== name || start + compressed > centralOffset || ranges.some(([a, b]) => local < b && start + compressed > a)) throw new Error('Conflicting ZIP entries');
      ranges.push([local, start + compressed]);
      const raw = buffer.subarray(start, start + compressed);
      const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, size) }) : raw;
      if (data.length !== size || crc32(data) !== crc || (name.endsWith('/') && size)) throw new Error('ZIP checksum/size mismatch');
      entries.set(name, data);
    }
    if (offset !== end) throw new Error('Invalid ZIP directory size');
    for (const name of entries.keys()) {
      const segments = name.split('/'); segments.pop();
      for (let i = 1; i <= segments.length; i++) if (entries.has(segments.slice(0, i).join('/'))) throw new Error('Conflicting ZIP path');
    }
    const manifest = validateManifest(JSON.parse(entries.get('manifest.json')?.toString('utf8') || 'null'), entries);
    return { manifest, entries };
  } catch (err) { throw fault(-32602, err.code === -32602 ? err.message : 'Invalid or unsafe plugin ZIP'); }
}
function createArchive(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, data] of [...entries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!safePath(name)) throw fault(-32602, 'Unsafe archive path');
    const filename = Buffer.from(name); const compressed = deflateRawSync(data); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); local.copy(header, 6, 4, 26); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); central.push(header, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...locals, directory, end]);
  readArchive(archive);
  return archive;
}
module.exports = { readArchive, createArchive, validateManifest, safePath, crc32, MAX_ZIP_BYTES, MAX_EXPANDED_BYTES, MAX_FILES };
