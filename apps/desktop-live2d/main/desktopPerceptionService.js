function toPlainBounds(bounds = {}) {
  return {
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Math.max(0, Number(bounds.width) || 0),
    height: Math.max(0, Number(bounds.height) || 0)
  };
}

function normalizeDisplayToken(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `display:${Math.trunc(value)}`;
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^display:\d+$/i.test(raw)) {
    return `display:${raw.split(':')[1]}`;
  }
  if (/^\d+$/.test(raw)) {
    return `display:${raw}`;
  }
  return raw;
}

function pointInBounds(point, bounds) {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  );
}

function boundsContainBounds(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function normalizePermissionStatus(value, { platform = process.platform } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return platform === 'darwin' ? 'unknown' : 'not_required';
  }
  return raw.replace(/_/g, '-');
}

function createDesktopPerceptionService({ screen, systemPreferences = null, platform = process.platform } = {}) {
  if (!screen || typeof screen.getAllDisplays !== 'function' || typeof screen.getPrimaryDisplay !== 'function') {
    throw new Error('desktop perception service requires Electron screen adapter');
  }

  function listDisplays() {
    const primaryDisplay = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((display, index) => {
      const electronId = Number(display?.id) || 0;
      const isPrimary = primaryDisplay && Number(primaryDisplay.id) === electronId;
      return {
        id: normalizeDisplayToken(electronId),
        electron_id: electronId,
        label: String(display?.label || (isPrimary ? 'Primary Display' : `Display ${index + 1}`)),
        primary: isPrimary,
        bounds: toPlainBounds(display?.bounds),
        work_area: toPlainBounds(display?.workArea || display?.work_area),
        scale_factor: Number(display?.scaleFactor) || 1
      };
    });
  }

  function resolveDisplayById(displayId) {
    const normalizedId = normalizeDisplayToken(displayId);
    if (!normalizedId) {
      return null;
    }
    return listDisplays().find((display) => display.id === normalizedId) || null;
  }

  function getPrimaryDisplay() {
    return listDisplays().find((display) => display.primary) || listDisplays()[0] || null;
  }

  function resolveDisplayForBounds(bounds) {
    const normalizedBounds = toPlainBounds(bounds);
    if (normalizedBounds.width <= 0 || normalizedBounds.height <= 0) {
      return null;
    }
    const displays = listDisplays();
    if (displays.length === 0) {
      return null;
    }
    const center = {
      x: normalizedBounds.x + normalizedBounds.width / 2,
      y: normalizedBounds.y + normalizedBounds.height / 2
    };
    return displays.find((display) => (
      boundsContainBounds(display.bounds, normalizedBounds) && pointInBounds(center, display.bounds)
    )) || null;
  }

  function getPermissions() {
    const displays = listDisplays();
    const screenCapture = {
      status: platform === 'darwin' ? 'unknown' : 'not_required',
      requires_permission: platform === 'darwin',
      reason: null
    };

    if (platform === 'darwin') {
      if (typeof systemPreferences?.getMediaAccessStatus === 'function') {
        try {
          screenCapture.status = normalizePermissionStatus(systemPreferences.getMediaAccessStatus('screen'), { platform });
        } catch (err) {
          screenCapture.status = 'unknown';
          screenCapture.reason = String(err?.message || 'screen capture permission probe failed');
        }
      } else {
        screenCapture.reason = 'systemPreferences.getMediaAccessStatus unavailable';
      }
    }

    return {
      platform,
      displays_available: displays.length > 0,
      screen_capture: screenCapture
    };
  }

  function getCapabilities() {
    const displays = listDisplays();
    const permissions = getPermissions();
    const permissionStatus = permissions.screen_capture?.status || 'unknown';
    const permissionDenied = permissionStatus === 'denied' || permissionStatus === 'restricted';
    const displayAvailable = displays.length > 0;
    const screenCaptureEnabled = displayAvailable && !permissionDenied;

    let reason = null;
    if (!displayAvailable) {
      reason = 'no displays are available';
    } else if (permissionDenied) {
      reason = `screen capture permission is ${permissionStatus}`;
    } else if (permissions.screen_capture?.reason) {
      reason = permissions.screen_capture.reason;
    }

    return {
      platform,
      displays_available: displayAvailable,
      screen_capture: screenCaptureEnabled,
      region_capture: screenCaptureEnabled,
      reason
    };
  }

  return {
    listDisplays,
    resolveDisplayById,
    getPrimaryDisplay,
    resolveDisplayForBounds,
    getPermissions,
    getCapabilities
  };
}

module.exports = {
  createDesktopPerceptionService,
  normalizeDisplayToken,
  normalizePermissionStatus,
  toPlainBounds
};
