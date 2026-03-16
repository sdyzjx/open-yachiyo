const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDesktopPerceptionService,
  normalizeDisplayToken
} = require('../../apps/desktop-live2d/main/desktopPerceptionService');

test('normalizeDisplayToken accepts numeric and prefixed display ids', () => {
  assert.equal(normalizeDisplayToken(7), 'display:7');
  assert.equal(normalizeDisplayToken('9'), 'display:9');
  assert.equal(normalizeDisplayToken('display:11'), 'display:11');
});

test('desktop perception service lists displays and resolves primary display', () => {
  const screen = {
    getPrimaryDisplay() {
      return {
        id: 2
      };
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
          label: 'Studio Display',
          bounds: { x: 0, y: 0, width: 1512, height: 982 },
          workArea: { x: 0, y: 25, width: 1512, height: 939 },
          scaleFactor: 2
        }
      ];
    }
  };

  const service = createDesktopPerceptionService({ screen });
  const displays = service.listDisplays();

  assert.equal(displays.length, 2);
  assert.equal(displays[0].id, 'display:1');
  assert.equal(displays[1].label, 'Studio Display');
  assert.equal(displays[1].primary, true);
  assert.equal(service.getPrimaryDisplay().id, 'display:2');
  assert.equal(service.resolveDisplayById('2').id, 'display:2');
});

test('desktop perception service resolves one display for global bounds only when fully contained', () => {
  const screen = {
    getPrimaryDisplay() {
      return { id: 1 };
    },
    getAllDisplays() {
      return [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          workArea: { x: 0, y: 0, width: 1200, height: 760 },
          scaleFactor: 2
        },
        {
          id: 2,
          bounds: { x: 1200, y: 0, width: 1200, height: 800 },
          workArea: { x: 1200, y: 0, width: 1200, height: 760 },
          scaleFactor: 1
        }
      ];
    }
  };

  const service = createDesktopPerceptionService({ screen });

  assert.equal(
    service.resolveDisplayForBounds({ x: 100, y: 100, width: 320, height: 240 }).id,
    'display:1'
  );
  assert.equal(
    service.resolveDisplayForBounds({ x: 1100, y: 10, width: 200, height: 100 }),
    null
  );
});
