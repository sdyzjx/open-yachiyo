const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WEB = path.join(__dirname, '../../apps/android/app/src/main/assets/web');

test('Android night theme exposes the attributed official background preset', () => {
  const settings = fs.readFileSync(path.join(WEB, 'js/settings.js'), 'utf8');
  assert.match(settings, /https:\/\/www\.cho-kaguyahime\.com\/assets\/img\/character\/character_bg\.jpg/);
  assert.match(settings, /图片来源/);
});

test('Android panel uses a pre-blurred internal layer instead of Live2D backdrop filtering', () => {
  const css = fs.readFileSync(path.join(WEB, 'css/app.css'), 'utf8');
  assert.match(css, /\.panel::before\s*\{[^}]*filter:\s*blur\(/s);
  assert.doesNotMatch(css, /\.panel(?:\.live)?\s*\{[^}]*backdrop-filter/s);
});
