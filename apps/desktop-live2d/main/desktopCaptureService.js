const { toPlainBounds } = require('./desktopPerceptionService');

function parseSourceDisplayId(source = {}) {
  const direct = String(source.display_id || source.displayId || '').trim();
  if (direct && /^\d+$/.test(direct)) {
    return Number(direct);
  }
  const sourceId = String(source.id || '').trim();
  const match = sourceId.match(/screen:(\d+):/i);
  return match ? Number(match[1]) : null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function normalizeCaptureDisplaySelector(params = {}) {
  return params.displayId ?? params.display_id ?? null;
}

function normalizeWindowSelector(params = {}) {
  const sourceId = String(params.sourceId ?? params.source_id ?? '').trim();
  const title = String(params.title ?? params.windowTitle ?? params.window_title ?? '').trim();
  return {
    sourceId: sourceId || null,
    title: title || null
  };
}

function normalizeRegionCaptureRequest(params = {}) {
  return {
    x: Number(params.x),
    y: Number(params.y),
    width: toPositiveInteger(params.width),
    height: toPositiveInteger(params.height),
    displayId: normalizeCaptureDisplaySelector(params)
  };
}

function normalizeWindowCaptureRequest(params = {}) {
  return normalizeWindowSelector(params);
}

function normalizeImageSize(image) {
  const size = typeof image?.getSize === 'function' ? image.getSize() : image?.size || {};
  return {
    width: Math.max(0, Number(size.width) || 0),
    height: Math.max(0, Number(size.height) || 0)
  };
}

function boundsContainBounds(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function normalizeWindowTitle(source = {}) {
  return String(source.name || source.title || '').trim();
}

function createDesktopCaptureService({
  perceptionService,
  captureStore,
  desktopCapturer,
  logger = console
} = {}) {
  if (!perceptionService || typeof perceptionService.listDisplays !== 'function') {
    throw new Error('desktop capture service requires perception service');
  }
  if (!captureStore || typeof captureStore.createCaptureRecord !== 'function') {
    throw new Error('desktop capture service requires capture store');
  }

  const captureAdapter = desktopCapturer || require('electron').desktopCapturer;
  if (!captureAdapter || typeof captureAdapter.getSources !== 'function') {
    throw new Error('desktop capture service requires Electron desktopCapturer');
  }

  function resolveWindowThumbnailSize() {
    const displays = typeof perceptionService.listDisplays === 'function'
      ? perceptionService.listDisplays()
      : [];
    const maxWidth = displays.reduce((acc, display) => (
      Math.max(acc, Math.round(display.bounds.width * display.scale_factor))
    ), 1920);
    const maxHeight = displays.reduce((acc, display) => (
      Math.max(acc, Math.round(display.bounds.height * display.scale_factor))
    ), 1080);
    return {
      width: Math.min(4096, Math.max(1, maxWidth)),
      height: Math.min(4096, Math.max(1, maxHeight))
    };
  }

  async function loadDisplaySource(display) {
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scale_factor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scale_factor))
    };
    const sources = await captureAdapter.getSources({
      types: ['screen'],
      fetchWindowIcons: false,
      thumbnailSize
    });
    const matched = sources.find((source) => parseSourceDisplayId(source) === display.electron_id);
    if (!matched) {
      throw new Error(`screen source not found for ${display.id}`);
    }
    if (!matched.thumbnail || typeof matched.thumbnail.toPNG !== 'function') {
      throw new Error(`screen source thumbnail unavailable for ${display.id}`);
    }
    return matched;
  }

  async function loadWindowSources({ includeThumbnail = true } = {}) {
    return captureAdapter.getSources({
      types: ['window'],
      fetchWindowIcons: false,
      thumbnailSize: includeThumbnail ? resolveWindowThumbnailSize() : { width: 1, height: 1 }
    });
  }

  function resolveTargetDisplay(displayId) {
    const requested = displayId != null ? perceptionService.resolveDisplayById(displayId) : null;
    const display = requested || perceptionService.getPrimaryDisplay();
    if (!display) {
      throw new Error('no display is available for desktop capture');
    }
    return display;
  }

  function toWindowDescriptor(source = {}) {
    const electronDisplayId = parseSourceDisplayId(source);
    const display = electronDisplayId != null ? perceptionService.resolveDisplayById(electronDisplayId) : null;
    return {
      source_id: String(source.id || '').trim(),
      title: normalizeWindowTitle(source),
      display_id: display?.id || null,
      electron_display_id: electronDisplayId,
      thumbnail_available: Boolean(source.thumbnail && typeof source.thumbnail.toPNG === 'function')
    };
  }

  function resolveWindowSource(sources, params = {}) {
    const selector = normalizeWindowCaptureRequest(params);
    if (!selector.sourceId && !selector.title) {
      throw new Error('desktop.capture.window requires source id or title');
    }

    if (selector.sourceId) {
      const matched = sources.find((source) => String(source.id || '').trim() === selector.sourceId);
      if (!matched) {
        throw new Error(`window source not found: ${selector.sourceId}`);
      }
      return matched;
    }

    const titleQuery = selector.title.toLowerCase();
    const exact = sources.filter((source) => normalizeWindowTitle(source).toLowerCase() === titleQuery);
    if (exact.length === 1) {
      return exact[0];
    }
    if (exact.length > 1) {
      throw new Error(`window title is ambiguous: ${selector.title}`);
    }

    const fuzzy = sources.filter((source) => normalizeWindowTitle(source).toLowerCase().includes(titleQuery));
    if (fuzzy.length === 1) {
      return fuzzy[0];
    }
    if (fuzzy.length > 1) {
      throw new Error(`window title is ambiguous: ${selector.title}`);
    }
    throw new Error(`window title not found: ${selector.title}`);
  }

  async function listWindows() {
    const sources = await loadWindowSources({ includeThumbnail: false });
    return {
      windows: sources.map((source) => toWindowDescriptor(source))
    };
  }

  async function captureScreen(params = {}) {
    const display = resolveTargetDisplay(normalizeCaptureDisplaySelector(params));
    const source = await loadDisplaySource(display);
    const image = source.thumbnail;
    const pixelSize = normalizeImageSize(image);
    const result = captureStore.createCaptureRecord({
      scope: 'display',
      displayId: display.id,
      bounds: display.bounds,
      pixelSize,
      scaleFactor: display.scale_factor,
      buffer: Buffer.from(image.toPNG()),
      extra: {
        electron_display_id: display.electron_id
      }
    });
    logger.info?.('[desktop-perception] capture screen created', {
      capture_id: result.capture_id,
      display_id: result.display_id,
      bounds: result.bounds
    });
    return result;
  }

  async function captureRegion(params = {}) {
    const normalized = normalizeRegionCaptureRequest(params);
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) || !normalized.width || !normalized.height) {
      throw new Error('desktop.capture.region requires finite x/y and positive width/height');
    }

    let display = null;
    let globalBounds = null;
    if (normalized.displayId != null) {
      display = perceptionService.resolveDisplayById(normalized.displayId);
      if (!display) {
        throw new Error(`display not found: ${normalized.displayId}`);
      }
      globalBounds = {
        x: display.bounds.x + normalized.x,
        y: display.bounds.y + normalized.y,
        width: normalized.width,
        height: normalized.height
      };
    } else {
      globalBounds = {
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height
      };
      display = perceptionService.resolveDisplayForBounds(globalBounds);
      if (!display) {
        throw new Error('desktop.capture.region currently requires the region to fit within a single display');
      }
    }

    if (!boundsContainBounds(display.bounds, globalBounds)) {
      throw new Error('desktop.capture.region requires the requested bounds to stay within one display');
    }

    const source = await loadDisplaySource(display);
    const image = source.thumbnail;
    const imageSize = normalizeImageSize(image);
    const scaleX = imageSize.width / Math.max(1, display.bounds.width);
    const scaleY = imageSize.height / Math.max(1, display.bounds.height);
    const cropRect = {
      x: Math.max(0, Math.round((globalBounds.x - display.bounds.x) * scaleX)),
      y: Math.max(0, Math.round((globalBounds.y - display.bounds.y) * scaleY)),
      width: Math.max(1, Math.round(globalBounds.width * scaleX)),
      height: Math.max(1, Math.round(globalBounds.height * scaleY))
    };

    if (typeof image.crop !== 'function') {
      throw new Error('desktop capture image cropping is unavailable');
    }

    const cropped = image.crop(cropRect);
    const pixelSize = normalizeImageSize(cropped);
    const displayRelativeBounds = {
      x: globalBounds.x - display.bounds.x,
      y: globalBounds.y - display.bounds.y,
      width: globalBounds.width,
      height: globalBounds.height
    };
    const result = captureStore.createCaptureRecord({
      scope: 'region',
      displayId: display.id,
      bounds: toPlainBounds(globalBounds),
      pixelSize,
      scaleFactor: display.scale_factor,
      buffer: Buffer.from(cropped.toPNG()),
      extra: {
        electron_display_id: display.electron_id,
        display_relative_bounds: displayRelativeBounds
      }
    });
    logger.info?.('[desktop-perception] capture region created', {
      capture_id: result.capture_id,
      display_id: result.display_id,
      bounds: result.bounds
    });
    return result;
  }

  async function captureWindow(params = {}) {
    const source = resolveWindowSource(await loadWindowSources({ includeThumbnail: true }), params);
    const image = source.thumbnail;
    if (!image || typeof image.toPNG !== 'function') {
      throw new Error('desktop window source thumbnail unavailable');
    }
    const pixelSize = normalizeImageSize(image);
    const descriptor = toWindowDescriptor(source);
    const display = descriptor.display_id
      ? perceptionService.resolveDisplayById(descriptor.display_id)
      : null;
    const result = captureStore.createCaptureRecord({
      scope: 'window',
      displayId: descriptor.display_id || '',
      bounds: null,
      pixelSize,
      scaleFactor: display?.scale_factor || 1,
      buffer: Buffer.from(image.toPNG()),
      extra: {
        electron_display_id: descriptor.electron_display_id,
        source_id: descriptor.source_id,
        window_title: descriptor.title
      }
    });
    logger.info?.('[desktop-perception] capture window created', {
      capture_id: result.capture_id,
      source_id: descriptor.source_id,
      window_title: descriptor.title
    });
    return result;
  }

  return {
    listWindows,
    captureScreen,
    captureRegion,
    captureWindow
  };
}

module.exports = {
  createDesktopCaptureService,
  normalizeRegionCaptureRequest,
  normalizeWindowCaptureRequest,
  normalizeWindowSelector,
  normalizeWindowTitle,
  parseSourceDisplayId
};
