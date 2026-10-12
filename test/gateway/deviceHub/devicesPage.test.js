const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { fixture } = require('./helpers');
const { createDevicesApi } = require('../../../apps/gateway/public/devices');

test('Devices page serves offline assets and API reports pairing, host and errors', async (t) => {
  const f = await fixture(t);
  f.app.use(express.static(path.resolve(__dirname, '../../../apps/gateway/public')));
  const page = await (await fetch(`${f.base}/devices.html`)).text();
  assert.match(page, /plugin-target/); assert.doesNotMatch(page, /https?:\/\/.*\.(js|css)/);
  assert.equal((await fetch(`${f.base}/devices.js`)).status, 200);
  const api = createDevicesApi({ base: f.base });
  assert.equal((await api.pairing()).token, 'test-token');
  await f.client('phone');
  assert.equal((await api.devices()).devices[0].device_id, 'phone');
  assert.deepEqual((await api.plugins()).plugins, []);
  await assert.rejects(api.transfer('missing'), /offline/);
  assert.equal((await api.transfer('desktop')).host, 'desktop');
});

test('Devices page client uses Bearer authorization and encodes write requests', async () => {
  const requests = [];
  const api = createDevicesApi({ getToken: () => 'test-token', fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({}) }; } });
  await api.transfer('phone'); await api.push('abc', 'phone'); await api.upload(Buffer.from('zip'));
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(requests[1].options.body), { target: 'phone' });
  assert.equal(requests[2].options.headers['content-type'], 'application/zip');
});
