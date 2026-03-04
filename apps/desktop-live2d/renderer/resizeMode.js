(function initResizeMode(globalScope) {
  const sharedDefaults = (
    globalScope.DesktopLive2dDefaults
    || ((typeof module !== 'undefined' && module.exports)
      ? require('../shared/defaultUiConfig')
      : null)
  );

  const DEFAULT_LAYOUT_CONFIG = sharedDefaults?.DEFAULT_LAYOUT_CONFIG || {
    offsetX: 0,
    offsetY: 95,
    scaleMultiplier: 1.25
  };

  const SLIDER_CONFIG = Object.freeze({
    offsetX: Object.freeze({ min: -120, max: 120, step: 1, decimals: 0 }),
    offsetY: Object.freeze({ min: -120, max: 120, step: 1, decimals: 0 }),
    scaleMultiplier: Object.freeze({ min: 0.7, max: 1.5, step: 0.01, decimals: 2 })
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function roundToStep(value, step, decimals) {
    const safeStep = Math.max(0.0001, Number(step) || 1);
    const safeDecimals = Math.max(0, Number(decimals) || 0);
    const rounded = Math.round(value / safeStep) * safeStep;
    return Number(rounded.toFixed(safeDecimals));
  }

  function normalizeLayoutOverrides(layout = {}, { defaults = DEFAULT_LAYOUT_CONFIG } = {}) {
    const next = {
      offsetX: toFiniteNumber(layout?.offsetX, defaults.offsetX),
      offsetY: toFiniteNumber(layout?.offsetY, defaults.offsetY),
      scaleMultiplier: toFiniteNumber(layout?.scaleMultiplier, defaults.scaleMultiplier)
    };

    next.offsetX = roundToStep(
      clamp(next.offsetX, SLIDER_CONFIG.offsetX.min, SLIDER_CONFIG.offsetX.max),
      SLIDER_CONFIG.offsetX.step,
      SLIDER_CONFIG.offsetX.decimals
    );
    next.offsetY = roundToStep(
      clamp(next.offsetY, SLIDER_CONFIG.offsetY.min, SLIDER_CONFIG.offsetY.max),
      SLIDER_CONFIG.offsetY.step,
      SLIDER_CONFIG.offsetY.decimals
    );
    next.scaleMultiplier = roundToStep(
      clamp(next.scaleMultiplier, SLIDER_CONFIG.scaleMultiplier.min, SLIDER_CONFIG.scaleMultiplier.max),
      SLIDER_CONFIG.scaleMultiplier.step,
      SLIDER_CONFIG.scaleMultiplier.decimals
    );

    return next;
  }

  function normalizeWindowState(windowState = {}) {
    const normalized = {};
    if (typeof windowState?.resizeModeEnabled === 'boolean') {
      normalized.resizeModeEnabled = windowState.resizeModeEnabled;
    }
    for (const key of ['width', 'height', 'x', 'y', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'defaultWidth', 'defaultHeight', 'aspectRatio']) {
      const value = Number(windowState?.[key]);
      if (Number.isFinite(value)) {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  function computeResizeRequestFromDrag({
    startWidth,
    startHeight,
    aspectRatio,
    deltaX = 0,
    deltaY = 0,
    persist = false,
    source = 'resize-mode'
  } = {}) {
    const safeWidth = Math.max(1, toFiniteNumber(startWidth, 320));
    const safeHeight = Math.max(1, toFiniteNumber(startHeight, 500));
    const safeAspectRatio = Math.max(0.01, toFiniteNumber(aspectRatio, safeWidth / safeHeight));
    const widthDeltaFromX = toFiniteNumber(deltaX, 0);
    const widthDeltaFromY = toFiniteNumber(deltaY, 0) * safeAspectRatio;
    const dominantWidthDelta = Math.abs(widthDeltaFromX) >= Math.abs(widthDeltaFromY)
      ? widthDeltaFromX
      : widthDeltaFromY;
    const nextWidth = Math.max(1, Math.round(safeWidth + dominantWidthDelta));
    const nextHeight = Math.max(1, Math.round(nextWidth / safeAspectRatio));

    return {
      action: 'set',
      width: nextWidth,
      height: nextHeight,
      persist: persist !== false,
      source: String(source || 'resize-mode')
    };
  }

  function createResizeModeController({
    document,
    bridge,
    layoutDefaults = DEFAULT_LAYOUT_CONFIG,
    getLayoutConfig = () => ({}),
    setLayoutConfig = null,
    onLayoutApplied = null
  } = {}) {
    if (!document || typeof document.getElementById !== 'function') {
      return null;
    }

    const body = document.body || null;
    const resizeModeCloseButton = document.getElementById('resize-mode-close');
    const layoutTunerToggleButton = document.getElementById('layout-tuner-toggle');
    const layoutTunerCloseButton = document.getElementById('layout-tuner-close');
    const layoutResetButton = document.getElementById('layout-reset');
    const layoutSaveButton = document.getElementById('layout-save');
    const layoutStatusElement = document.getElementById('layout-tuner-status');
    const offsetXInput = document.getElementById('layout-offset-x');
    const offsetYInput = document.getElementById('layout-offset-y');
    const scaleInput = document.getElementById('layout-scale');
    const offsetXValue = document.getElementById('layout-offset-x-value');
    const offsetYValue = document.getElementById('layout-offset-y-value');
    const scaleValue = document.getElementById('layout-scale-value');

    const sliderElements = {
      offsetXInput,
      offsetYInput,
      scaleInput,
      offsetXValue,
      offsetYValue,
      scaleValue
    };

    const state = {
      resizeModeEnabled: false,
      tunerOpen: false,
      windowState: null,
      layout: normalizeLayoutOverrides(getLayoutConfig(), { defaults: layoutDefaults })
    };

    function setStatus(message = '') {
      if (layoutStatusElement) {
        layoutStatusElement.textContent = String(message || '');
      }
    }

    function updateBodyClasses() {
      if (!body?.classList) {
        return;
      }
      body.classList.toggle('resize-mode-active', state.resizeModeEnabled);
      body.classList.toggle('layout-tuner-open', state.resizeModeEnabled && state.tunerOpen);
    }

    function syncLayoutInputs(layout) {
      if (offsetXInput) offsetXInput.value = String(layout.offsetX);
      if (offsetYInput) offsetYInput.value = String(layout.offsetY);
      if (scaleInput) scaleInput.value = layout.scaleMultiplier.toFixed(2);
      if (offsetXValue) offsetXValue.textContent = String(layout.offsetX);
      if (offsetYValue) offsetYValue.textContent = String(layout.offsetY);
      if (scaleValue) scaleValue.textContent = layout.scaleMultiplier.toFixed(2);
    }

    function applyLayout(layout, { statusMessage = 'Unsaved changes' } = {}) {
      const normalized = normalizeLayoutOverrides(layout, { defaults: layoutDefaults });
      state.layout = normalized;
      syncLayoutInputs(normalized);
      if (typeof setLayoutConfig === 'function') {
        setLayoutConfig(normalized);
      }
      if (typeof onLayoutApplied === 'function') {
        onLayoutApplied(normalized);
      }
      setStatus(statusMessage);
      return normalized;
    }

    function readLayoutFromInputs() {
      return normalizeLayoutOverrides({
        offsetX: offsetXInput?.value,
        offsetY: offsetYInput?.value,
        scaleMultiplier: scaleInput?.value
      }, { defaults: layoutDefaults });
    }

    function syncLayoutFromRuntime() {
      state.layout = normalizeLayoutOverrides(getLayoutConfig(), { defaults: layoutDefaults });
      syncLayoutInputs(state.layout);
      return state.layout;
    }

    function handleWindowStateSync(payload = {}) {
      const normalized = normalizeWindowState(payload);
      state.windowState = {
        ...(state.windowState || {}),
        ...normalized
      };

      if (typeof normalized.resizeModeEnabled === 'boolean') {
        state.resizeModeEnabled = normalized.resizeModeEnabled;
        if (!state.resizeModeEnabled) {
          state.tunerOpen = false;
        }
      }

      updateBodyClasses();
      return state.windowState;
    }

    resizeModeCloseButton?.addEventListener('click', () => {
      state.resizeModeEnabled = false;
      state.tunerOpen = false;
      updateBodyClasses();
      bridge?.sendWindowControl?.({ action: 'close_resize_mode' });
    });

    layoutTunerToggleButton?.addEventListener('click', () => {
      if (!state.resizeModeEnabled) {
        return;
      }
      state.tunerOpen = !state.tunerOpen;
      updateBodyClasses();
    });

    layoutTunerCloseButton?.addEventListener('click', () => {
      state.tunerOpen = false;
      updateBodyClasses();
    });

    layoutResetButton?.addEventListener('click', () => {
      applyLayout(layoutDefaults, { statusMessage: 'Reset to defaults' });
    });

    layoutSaveButton?.addEventListener('click', () => {
      const normalized = applyLayout(readLayoutFromInputs(), { statusMessage: 'Saved' });
      bridge?.sendWindowControl?.({
        action: 'save_layout_overrides',
        layout: normalized
      });
    });

    for (const input of [offsetXInput, offsetYInput, scaleInput]) {
      input?.addEventListener('input', () => {
        applyLayout(readLayoutFromInputs());
      });
    }

    syncLayoutFromRuntime();
    updateBodyClasses();

    return {
      handleWindowStateSync,
      syncLayoutFromRuntime,
      getWindowState() {
        return state.windowState ? { ...state.windowState } : null;
      },
      getLayoutOverrides() {
        return { ...state.layout };
      },
      isResizeModeEnabled() {
        return state.resizeModeEnabled;
      }
    };
  }

  const api = {
    SLIDER_CONFIG,
    normalizeLayoutOverrides,
    normalizeWindowState,
    computeResizeRequestFromDrag,
    createResizeModeController
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.Live2DResizeMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
