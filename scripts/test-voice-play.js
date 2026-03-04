#!/usr/bin/env node

console.error('[deprecated] scripts/test-voice-play.js is removed with file playback path.');
console.error('[deprecated] Use API memory playback flow instead:');
console.error('  1) npm run desktop:up');
console.error('  2) Trigger a normal chat reply (voice.requested -> desktop:voice:play-memory)');
console.error('  3) Or run: node scripts/test-voice-lipsync.js');
process.exit(1);
