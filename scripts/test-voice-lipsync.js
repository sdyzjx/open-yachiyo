#!/usr/bin/env node
/**
 * Test script for voice lipsync integration
 *
 * Usage:
 *   1. Start desktop app: npm run desktop:up
 *   2. Open DevTools in the desktop window (Cmd+Option+I)
 *   3. Run this script: node scripts/test-voice-lipsync.js
 *   4. Watch the console logs in DevTools
 */

const http = require('http');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const SESSION_ID = 'desktop-live2d-chat';

async function sendVoiceRequest(text) {
  console.log(`\n[Test] Sending voice request: "${text}"`);

  const payload = {
    type: 'runtime.event',
    timestamp: Date.now(),
    data: {
      name: 'voice.requested',
      data: {
        request_id: `test-${Date.now()}`,
        text,
        timeoutSec: 30,
        model: 'qwen3-tts-vc-2026-01-22',
        voiceId: 'qwen-tts-vc-yachiyo-voice-20260224022238839-5679'
      },
      session_id: SESSION_ID
    }
  };

  return new Promise((resolve, reject) => {
    const url = new URL('/api/desktop-event', GATEWAY_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[Test] Voice request sent successfully');
          resolve(data);
        } else {
          console.error('[Test] Voice request failed:', res.statusCode, data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Test] Request error:', err);
      reject(err);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function main() {
  console.log('[Test] Voice Lipsync Test Script');
  console.log('[Test] Gateway URL:', GATEWAY_URL);
  console.log('[Test] Session ID:', SESSION_ID);
  console.log('\n[Test] Instructions:');
  console.log('  1. Make sure desktop app is running (npm run desktop:up)');
  console.log('  2. Open DevTools in the desktop window (Cmd+Option+I)');
  console.log('  3. Watch the Console tab for [lipsync] logs');
  console.log('\n[Test] Starting test...\n');

  try {
    // Test 1: Short Japanese phrase
    await sendVoiceRequest('こんにちは');
    console.log('[Test] Test 1 sent. Check DevTools console for [lipsync] logs.');

    // Wait a bit before next test
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 2: Longer phrase
    await sendVoiceRequest('今日はいい天気ですね。');
    console.log('[Test] Test 2 sent. Check DevTools console for [lipsync] logs.');

    console.log('\n[Test] All tests sent. Check DevTools console for results.');
    console.log('[Test] Look for these log patterns:');
    console.log('  - [lipsync] playVoiceFromBase64 called');
    console.log('  - [lipsync] startLipsync called');
    console.log('  - [lipsync] AudioContext created');
    console.log('  - [lipsync] Audio nodes connected');
    console.log('  - [lipsync] Runtime state created');
    console.log('  - [lipsync] Animation loop started');
    console.log('  - [lipsync] frame update (every ~1 second)');
    console.log('  - [lipsync] stopLipsync called (when audio ends)');
  } catch (err) {
    console.error('[Test] Test failed:', err);
    process.exit(1);
  }
}

main();
