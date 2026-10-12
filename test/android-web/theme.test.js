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

test('Android pages link the shared Yachiyo theme before their own stylesheet and use --y-* tokens', () => {
  const { SHARED_FILES } = require('../../scripts/android-sync-assets');
  assert.ok(SHARED_FILES.some(([from, to]) => to === 'yachiyo-theme.css' && from === 'apps/desktop-live2d/shared/theme/yachiyo-theme.css'));
  for (const [page, own] of [['index.html', 'css/app.css'], ['settings.html', 'css/settings.css']]) {
    const html = fs.readFileSync(path.join(WEB, page), 'utf8');
    const theme = html.indexOf('/generated/shared/yachiyo-theme.css');
    assert.ok(theme > 0, `${page} links the theme`);
    assert.ok(theme < html.indexOf(own), `${page} loads the theme before ${own}`);
    const css = fs.readFileSync(path.join(WEB, own), 'utf8');
    assert.match(css, /var\(--y-/);
    assert.doesNotMatch(css, /--(?:accent-2|glass-line|glass-strong|gold-line|ink-dim|surface-strong)\s*:/, 'no duplicated colour variables');
  }
});
