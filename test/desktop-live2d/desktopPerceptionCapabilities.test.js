const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDesktopPerceptionService,
  normalizePermissionStatus
} = require('../../apps/desktop-live2d/main/desktopPerceptionService');

function createMockScreen() {
  return {
    getPrimaryDisplay() {
      return { id: 1 };
    },
    getAllDisplays() {
      return [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          workArea: { x: 0, y: 25, width: 1440, height: 875 },
          scaleFactor: 2
        }
      ];
    }
  };
}

test('normalizePermissionStatus normalizes darwin and non-darwin defaults', () => {
  assert.equal(normalizePermissionStatus('', { platform: 'darwin' }), 'unknown');
  assert.equal(normalizePermissionStatus('', { platform: 'win32' }), 'not_required');
  assert.equal(normalizePermissionStatus('not_determined', { platform: 'darwin' }), 'not-determined');
});

test('desktop perception service reports screen capture permission on macOS', () => {
  const service = createDesktopPerceptionService({
    screen: createMockScreen(),
    systemPreferences: {
      getMediaAccessStatus(type) {
        assert.equal(type, 'screen');
        return 'granted';
      }
    },
    platform: 'darwin'
  });

  const permissions = service.getPermissions();
  assert.equal(permissions.platform, 'darwin');
  assert.equal(permissions.displays_available, true);
  assert.equal(permissions.screen_capture.status, 'granted');
  assert.equal(permissions.screen_capture.requires_permission, true);

  const capabilities = service.getCapabilities();
  assert.equal(capabilities.screen_capture, true);
  assert.equal(capabilities.region_capture, true);
  assert.equal(capabilities.reason, null);
});

test('desktop perception service reports denied capture on macOS when permission is blocked', () => {
  const service = createDesktopPerceptionService({
    screen: createMockScreen(),
    systemPreferences: {
      getMediaAccessStatus() {
        return 'denied';
      }
    },
    platform: 'darwin'
  });

  const capabilities = service.getCapabilities();
  assert.equal(capabilities.screen_capture, false);
  assert.match(String(capabilities.reason || ''), /denied/);
});

test('desktop perception service marks non-macOS capture permission as not required', () => {
  const service = createDesktopPerceptionService({
    screen: createMockScreen(),
    platform: 'win32'
  });

  const permissions = service.getPermissions();
  assert.equal(permissions.screen_capture.status, 'not_required');
  assert.equal(permissions.screen_capture.requires_permission, false);
  assert.equal(service.getCapabilities().screen_capture, true);
});
