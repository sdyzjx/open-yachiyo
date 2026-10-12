#!/usr/bin/env node
// Generates the macOS menu-bar template icons (black + alpha only) into assets/tray/.
// "Template" in the file name makes macOS tint the icon for light/dark menu bars.
// Usage: node scripts/gen-tray-icon.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'assets', 'tray');
const SUPERSAMPLE = 8;

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, alpha) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = 0; raw[offset + 1] = 0; raw[offset + 2] = 0;
      raw[offset + 3] = alpha[y * size + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

// Crescent moon (disc minus offset disc) plus a four-point sparkle, in unit coordinates.
function covered(u, v) {
  const inDisc = (cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  const moon = inDisc(0.44, 0.54, 0.37) && !inDisc(0.60, 0.44, 0.31);
  const dx = Math.abs(u - 0.8);
  const dy = Math.abs(v - 0.24);
  const sparkle = dx ** 0.7 + dy ** 0.7 <= 0.16 ** 0.7;
  return moon || sparkle;
}

function render(size) {
  const alpha = new Uint8Array(size * size);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hit = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          if (covered((x + (sx + 0.5) / SUPERSAMPLE) / size, (y + (sy + 0.5) / SUPERSAMPLE) / size)) hit += 1;
        }
      }
      alpha[y * size + x] = Math.round((hit / samples) * 255);
    }
  }
  return alpha;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, size] of [['yachiyoTemplate.png', 16], ['yachiyoTemplate@2x.png', 32]]) {
    fs.writeFileSync(path.join(OUT_DIR, name), encodePng(size, render(size)));
    console.log(`wrote ${path.join('assets', 'tray', name)}`);
  }
}

if (require.main === module) main();
module.exports = { encodePng, render, covered };
