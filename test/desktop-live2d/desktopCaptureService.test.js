const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDesktopPerceptionService } = require('../../apps/desktop-live2d/main/desktopPerceptionService');
const { createDesktopCaptureStore } = require('../../apps/desktop-live2d/main/desktopCaptureStore');
const {
  createDesktopCaptureService,
  computeDownsampledSize,
  downsampleCaptureImage,
  computeVirtualDesktopBounds,
  normalizeRegionCaptureRequest,
  normalizeWindowCaptureRequest,
  normalizeWindowSelector,
  normalizeWindowTitle,
  parseSourceDisplayId
} = require('../../apps/desktop-live2d/main/desktopCaptureService');

function createFakeImage({ width, height, label = 'img' }) {
  const fillByte = label.charCodeAt(0) || 0;
  return {
    getSize() {
      return { width, height };
    },
    toPNG() {
      return Buffer.from(`${label}:${width}x${height}`);
    },
    toBitmap() {
      return Buffer.alloc(width * height * 4, fillByte);
    },
    resize({ width: nextWidth, height: nextHeight }) {
      return createFakeImage({
        width: nextWidth,
        height: nextHeight,
        label: `resize:${label}`
      });
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

test('normalizeWindowCaptureRequest keeps source id and title selectors', () => {
  assert.deepEqual(normalizeWindowSelector({
    source_id: 'window:42:0',
    window_title: 'Browser'
  }), {
    sourceId: 'window:42:0',
    title: 'Browser'
  });
  assert.deepEqual(normalizeWindowCaptureRequest({
    title: 'Editor'
  }), {
    sourceId: null,
    title: 'Editor'
  });
});

test('normalizeWindowTitle falls back to empty string', () => {
  assert.equal(normalizeWindowTitle({ name: 'Browser' }), 'Browser');
  assert.equal(normalizeWindowTitle({}), '');
});

test('computeVirtualDesktopBounds merges all display bounds', () => {
  const bounds = computeVirtualDesktopBounds([
    { bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
    { bounds: { x: 0, y: 0, width: 1512, height: 982 } }
  ]);

  assert.deepEqual(bounds, {
    x: -1280,
    y: 0,
    width: 2792,
    height: 982
  });
});

test('computeDownsampledSize preserves smaller images and fits larger ones into 1280x720', () => {
  assert.deepEqual(
    computeDownsampledSize({ width: 640, height: 360 }),
    { width: 640, height: 360, resized: false }
  );
  assert.deepEqual(
    computeDownsampledSize({ width: 3024, height: 1964 }),
    { width: 1109, height: 720, resized: true }
  );
});

test('downsampleCaptureImage resizes images larger than 720p envelope', () => {
  const image = createFakeImage({ width: 3024, height: 1964, label: 'primary' });
  const downsampled = downsampleCaptureImage(image);
  assert.deepEqual(downsampled.getSize(), { width: 1109, height: 720 });
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
  assert.deepEqual(record.pixel_size, { width: 1109, height: 720 });
  assert.equal(fs.existsSync(record.path), true);
});

test('desktop capture service captures the full virtual desktop across displays', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const createBitmapCalls = [];
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'screen:1:0', display_id: '1', thumbnail: createFakeImage({ width: 1280, height: 720, label: 'left' }) },
        { id: 'screen:2:0', display_id: '2', thumbnail: createFakeImage({ width: 3024, height: 1964, label: 'primary' }) }
      ];
    }
  };
  const nativeImage = {
    createFromBitmap(buffer, options) {
      createBitmapCalls.push({
        bytes: buffer.length,
        options
      });
      return createFakeImage({
        width: options.width,
        height: options.height,
        label: `desktop:${options.width}x${options.height}`
      });
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    nativeImage,
    logger: { info() {} }
  });

  const record = await captureService.captureDesktop();
  assert.equal(record.scope, 'desktop');
  assert.equal(record.display_id, '');
  assert.deepEqual(record.display_ids, ['display:1', 'display:2']);
  assert.equal(record.display_count, 2);
  assert.deepEqual(record.bounds, { x: -1280, y: 0, width: 2792, height: 982 });
  assert.deepEqual(record.pixel_size, { width: 1280, height: 450 });
  assert.deepEqual(createBitmapCalls, [{
    bytes: 2792 * 982 * 4,
    options: { width: 2792, height: 982, scaleFactor: 1 }
  }]);
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

test('desktop capture service captures one region across multiple displays via virtual desktop composition', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'screen:1:0', display_id: '1', thumbnail: createFakeImage({ width: 1280, height: 720, label: 'left' }) },
        { id: 'screen:2:0', display_id: '2', thumbnail: createFakeImage({ width: 3024, height: 1964, label: 'primary' }) }
      ];
    }
  };
  const nativeImage = {
    createFromBitmap(buffer, options) {
      return {
        getSize() {
          return { width: options.width, height: options.height };
        },
        toPNG() {
          return Buffer.from(`desktop:${options.width}x${options.height}:${buffer.length}`);
        },
        crop(rect) {
          return createFakeImage({
            width: rect.width,
            height: rect.height,
            label: `desktop-crop:${rect.x},${rect.y}`
          });
        }
      };
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    nativeImage,
    logger: { info() {} }
  });

  const record = await captureService.captureRegion({
    x: -100,
    y: 10,
    width: 200,
    height: 40
  });

  assert.equal(record.scope, 'region');
  assert.equal(record.display_id, '');
  assert.deepEqual(record.display_ids, ['display:1', 'display:2']);
  assert.equal(record.display_count, 2);
  assert.deepEqual(record.bounds, { x: -100, y: 10, width: 200, height: 40 });
  assert.deepEqual(record.pixel_size, { width: 200, height: 40 });
});

test('desktop capture service lists capturable windows', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'window:101:0', name: 'Browser', thumbnail: createFakeImage({ width: 1, height: 1, label: 'browser' }) },
        { id: 'window:202:0', name: 'Terminal', thumbnail: createFakeImage({ width: 1, height: 1, label: 'terminal' }) }
      ];
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    logger: { info() {} }
  });

  const result = await captureService.listWindows();
  assert.deepEqual(result, {
    windows: [
      {
        source_id: 'window:101:0',
        title: 'Browser',
        display_id: null,
        electron_display_id: null,
        thumbnail_available: true
      },
      {
        source_id: 'window:202:0',
        title: 'Terminal',
        display_id: null,
        electron_display_id: null,
        thumbnail_available: true
      }
    ]
  });
});

test('desktop capture service captures one window by source id', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'window:101:0', name: 'Browser', thumbnail: createFakeImage({ width: 1280, height: 720, label: 'browser' }) }
      ];
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    logger: { info() {} }
  });

  const record = await captureService.captureWindow({ source_id: 'window:101:0' });
  assert.equal(record.scope, 'window');
  assert.equal(record.source_id, 'window:101:0');
  assert.equal(record.window_title, 'Browser');
  assert.deepEqual(record.pixel_size, { width: 1280, height: 720 });
});

test('desktop capture service downsamples large windows to 720p envelope', async () => {
  const { perceptionService, captureStore } = createTestServices();
  const desktopCapturer = {
    async getSources() {
      return [
        { id: 'window:101:0', name: 'Browser', thumbnail: createFakeImage({ width: 3024, height: 1964, label: 'browser' }) }
      ];
    }
  };
  const captureService = createDesktopCaptureService({
    perceptionService,
    captureStore,
    desktopCapturer,
    logger: { info() {} }
  });

  const record = await captureService.captureWindow({ source_id: 'window:101:0' });
  assert.deepEqual(record.pixel_size, { width: 1109, height: 720 });
});
