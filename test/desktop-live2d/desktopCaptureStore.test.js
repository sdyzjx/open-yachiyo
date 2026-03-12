const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDesktopCaptureStore } = require('../../apps/desktop-live2d/main/desktopCaptureStore');

test('desktop capture store creates, reads, and deletes capture records', () => {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-capture-store-'));
  const store = createDesktopCaptureStore({
    captureDir,
    randomId: () => 'fixedcapture'
  });

  const record = store.createCaptureRecord({
    scope: 'display',
    displayId: 'display:7',
    bounds: { x: 0, y: 0, width: 640, height: 480 },
    pixelSize: { width: 1280, height: 960 },
    scaleFactor: 2,
    buffer: Buffer.from('fake-png')
  });

  assert.equal(record.capture_id, 'cap_fixedcapture');
  assert.equal(fs.existsSync(record.path), true);
  assert.equal(store.getCaptureRecord(record.capture_id).display_id, 'display:7');

  const deleted = store.deleteCaptureRecord(record.capture_id);
  assert.equal(deleted.deleted, true);
  assert.equal(fs.existsSync(record.path), false);
  assert.equal(store.getCaptureRecord(record.capture_id), null);
});

test('desktop capture store cleans up expired captures', () => {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-capture-store-expire-'));
  let currentNow = 1000;
  const store = createDesktopCaptureStore({
    captureDir,
    ttlMs: 50,
    now: () => currentNow,
    randomId: () => `id${currentNow}`
  });

  const first = store.createCaptureRecord({
    scope: 'display',
    displayId: 'display:1',
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    pixelSize: { width: 1, height: 1 },
    scaleFactor: 1,
    buffer: Buffer.from('a')
  });

  currentNow = 1100;
  const result = store.cleanupExpiredCaptures();
  assert.equal(result.deleted_count, 1);
  assert.deepEqual(result.deleted_capture_ids, [first.capture_id]);
  assert.equal(store.getCaptureRecord(first.capture_id), null);
});
