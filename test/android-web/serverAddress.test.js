'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const address = require('../../apps/android/app/src/main/assets/web/js/serverAddress.js');

test('formats IPv4 and IPv6 endpoints for URLs', () => {
  assert.equal(address.baseUrl('ws', '192.168.20.212', 3000), 'ws://192.168.20.212:3000');
  assert.equal(address.baseUrl('http', '2001:db8::2', 4321), 'http://[2001:db8::2]:4321');
  assert.equal(address.baseUrl('http', 'fe80::1%wlan0', 3000), 'http://[fe80::1%25wlan0]:3000');
});

test('endpoint comparison ignores IPv6 brackets but includes the port', () => {
  assert.equal(address.sameEndpoint({ host: '[2001:db8::2]', port: 3000 }, { host: '2001:db8::2', port: 3000 }), true);
  assert.equal(address.sameEndpoint({ host: 'server.local', port: 3000 }, { host: 'server.local', port: 3001 }), false);
});

test('endpoint selection preserves a token only for the same server', () => {
  const current = { host: '192.168.20.212', port: 3000, token: 'secret' };
  assert.deepEqual(address.endpointPatch(current, { host: '192.168.20.212', port: 3000 }), current);
  assert.deepEqual(address.endpointPatch(current, { host: '192.168.20.99', port: 3000 }), { host: '192.168.20.99', port: 3000, token: '' });
  assert.deepEqual(address.endpointPatch(current, { host: '192.168.20.212', port: 3001 }), { host: '192.168.20.212', port: 3001, token: '' });
});
