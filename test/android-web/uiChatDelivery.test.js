'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '../../apps/android/app/src/main/assets/web/js/app.js'), 'utf8');

test('TC-AWB-049 Android renders explicit ui.chat.post independently from legacy final events', () => {
  assert.match(app, /B\.subscribe\('ui\.chat\.post'/);
  assert.match(app, /taskCanvasApi\.final\(text, \{ trace_id: d\.trace_id \|\| d\.message_id \}\)/);
  assert.match(app, /B\.subscribe\('chat\.final'/);
});
