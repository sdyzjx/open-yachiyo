const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDesktopPerceptionService } = require('../../apps/desktop-live2d/main/desktopPerceptionService');
const { createDesktopCaptureStore } = require('../../apps/desktop-live2d/main/desktopCaptureStore');
const {
  createDesktopCaptureService,
  normalizeRegionCaptureRequest,
  parseSourceDisplayId
} = require('../../apps/desktop-live2d/main/desktopCaptureService');

function createFakeImage({ width, height, label = 'img' }) {
  return {
    getSize() {
      return { width, height };
    },
    toPNG() {
      return Buffer.from(`${label}:${width}x${height}`);
    },
    crop(rect) {
      return createFakeImage({
        width: rect.width,
        height: rect.height,
        label: `crop:${rect.x},${rect.y}`
      });
    }
  };
}

function createTestServices() {
  const screen = {
    getPrimaryDisplay() {
      return { id: 2 };
    },
    getAllDisplays() {
      return [
        {
          id: 1,
          bounds: { x: -1280, y: 0, width: 1280, height: 720 },
          workArea: { x: -1280, y: 0, width: 1280, height: 680 },
          scaleFactor: 1
        },
        {
          id: 2,
          bounds: { x: 0, y: 0, width: 1512, height: 982 },
          workArea: { x: 0, y: 25, width: 1512, height: 939 },
          scaleFactor: 2
        }
      ];
    }
  };
  const perceptionService = createDesktopPerceptionService({ screen });
  const captureStore = createDesktopCaptureStore({
    captureDir: fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-capture-service-'))
  });
  return { perceptionService, captureStore };
}

test('parseSourceDisplayId extracts display id from response shape', () => {
  assert.equal(parseSourceDisplayId({ display_id: '17' }), 17);
  assert.equal(parseSourceDisplayId({ id: 'screen:42:0' }), 42);
});

test('normalizeRegionCaptureRequest keeps display selector and positive size', () => {
  assert.deepEqual(normalizeRegionCaptureRequest({
    x: '10',
    y: '20',
    width: '120',
    height: '90',
    display_id: 'display:2'
  }), {
    x: 10,
    y: 20,
    width: 120,
    height: 90,
    displayId: 'display:2'
  });
});

test('desktop capture service captures one full display', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'screen:1:0', display_id: '1', thumbnail: createFakeImage({ width: 1280, height: 720, label: 'left' }) },
        { id: 'screen:2:0', display_id: '2', thumbnail: createFakeImage({ width: 3024, height: 1964, label: 'primary' }) }
      ];
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    logger: { info() {} }
  });

  const record = await captureService.captureScreen({ display_id: 'display:2' });
  assert.equal(record.scope, 'display');
  assert.equal(record.display_id, 'display:2');
  assert.deepEqual(record.pixel_size, { width: 3024, height: 1964 });
  assert.equal(fs.existsSync(record.path), true);
});

test('desktop capture service captures one region within a single display', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'screen:2:0', display_id: '2', thumbnail: createFakeImage({ width: 3024, height: 1964, label: 'primary' }) }
      ];
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    logger: { info() {} }
  });

  const record = await captureService.captureRegion({
    display_id: 'display:2',
    x: 20,
    y: 10,
    width: 100,
    height: 50
  });

  assert.equal(record.scope, 'region');
  assert.equal(record.display_id, 'display:2');
  assert.deepEqual(record.bounds, { x: 20, y: 10, width: 100, height: 50 });
  assert.deepEqual(record.display_relative_bounds, { x: 20, y: 10, width: 100, height: 50 });
  assert.deepEqual(record.pixel_size, { width: 200, height: 100 });
});
