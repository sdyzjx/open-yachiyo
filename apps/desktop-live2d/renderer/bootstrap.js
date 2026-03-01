(function bootstrap() {
  const bridge = window.desktopLive2dBridge;
  const interactionApi = window.Live2DInteraction || null;
  const actionMessageApi = window.Live2DActionMessage || null;
  const actionMutexApi = window.Live2DActionMutex || null;
  const actionQueueApi = window.Live2DActionQueuePlayer || null;
  const actionExecutorApi = window.Live2DActionExecutor || null;
  const visemeLipSyncApi = window.Live2DVisemeLipSync || null;
  const state = {
    modelLoaded: false,
    modelName: null,
    bubbleVisible: false,
    chatPanelVisible: false,
    chatHistorySize: 0,
    lastError: null,
    layout: null,
    windowState: null,
    resizeModeEnabled: false
  };

  let pixiApp = null;
  let live2dModel = null;
  let hideBubbleTimer = null;
  const systemAudio = new Audio();
  systemAudio.autoplay = true;
  systemAudio.preload = 'auto';
  let currentVoiceObjectUrl = null;
  let lipsyncCtx = null;
  let lipsyncAnalyser = null;
  let lipsyncSource = null;
  let lipsyncRafId = 0;
  let lipsyncSmoothed = 0;
  let lipsyncSmoothedForm = 0;
  let lipsyncCurrentMouthOpen = 0;
  let lipsyncCurrentMouthForm = 0;
  let lipsyncAudioEl = null;
  let lipsyncTimeDomainBuffer = null;
  let lipsyncFrequencyBuffer = null;
  let lipsyncParamMetaCache = null;
  let lipsyncVisemeState = visemeLipSyncApi?.createRuntimeState?.() || null;
  let lipsyncLastVisemeFrame = null;
  let recentVoicePlaybackKeys = new Map();
  let detachLipSyncPlaybackListeners = null;
  let detachLipSyncTicker = null;
  let detachLipSyncModelHook = null;
  let lastLipSyncDebugLogAt = 0;
  let lipsyncLastVoiceAt = 0;
  let dragPointerState = null;
  let suppressModelTapUntil = 0;
  let stableModelScale = null;
  let stableModelPose = null;
  let resizeModeScaleFactor = 1;
  let lastResizeModeRequest = null;
  let modelBaseBounds = null;
  let actionQueuePlayer = null;
  let actionExecutionMutex = null;
  let actionExecutor = null;

  const stageContainer = document.getElementById('stage');
  const bubbleLayerElement = document.getElementById('bubble-layer');
  const bubbleElement = document.getElementById('bubble');
  const chatPanelElement = document.getElementById('chat-panel');
  const chatPanelMessagesElement = document.getElementById('chat-panel-messages');
  const chatInputElement = document.getElementById('chat-input');
  const chatSendElement = document.getElementById('chat-send');
  const chatComposerElement = document.getElementById('chat-panel-composer');
  const petHideElement = document.getElementById('pet-hide');
  const petCloseElement = document.getElementById('pet-close');
  const resizeModeCloseElement = document.getElementById('resize-mode-close');
  const mouthTunerToggleElement = document.getElementById('mouth-tuner-toggle');
  const mouthTunerPanelElement = document.getElementById('mouth-tuner-panel');
  const mouthTunerCloseElement = document.getElementById('mouth-tuner-close');
  const mouthTunerEnableElement = document.getElementById('mouth-tuner-enable');
  const mouthOpenElement = document.getElementById('mouth-open');
  const mouthFormElement = document.getElementById('mouth-form');
  const mouthOpenValueElement = document.getElementById('mouth-open-value');
  const mouthFormValueElement = document.getElementById('mouth-form-value');
  const mouthNeutralElement = document.getElementById('mouth-neutral');
  const mouthApplyIElement = document.getElementById('mouth-apply-i');
  const mouthTunerStatusElement = document.getElementById('mouth-tuner-status');
  const layoutTunerToggleElement = document.getElementById('layout-tuner-toggle');
  const layoutTunerPanelElement = document.getElementById('layout-tuner-panel');
  const layoutTunerCloseElement = document.getElementById('layout-tuner-close');
  const layoutOffsetXElement = document.getElementById('layout-offset-x');
  const layoutOffsetYElement = document.getElementById('layout-offset-y');
  const layoutScaleElement = document.getElementById('layout-scale');
  const layoutOffsetXValueElement = document.getElementById('layout-offset-x-value');
  const layoutOffsetYValueElement = document.getElementById('layout-offset-y-value');
  const layoutScaleValueElement = document.getElementById('layout-scale-value');
  const layoutResetElement = document.getElementById('layout-reset');
  const layoutSaveElement = document.getElementById('layout-save');
  const layoutTunerStatusElement = document.getElementById('layout-tuner-status');

  const chatStateApi = window.ChatPanelState;
  let runtimeUiConfig = null;
  let runtimeLive2dPresets = null;
  let mouthTunerState = {
    open: false,
    enabled: false,
    values: {
      mouthOpen: 0,
      mouthForm: 0
    }
  };
  let externalMouthOverrideState = {
    enabled: false,
    values: {
      mouthOpen: 0,
      mouthForm: 0
    }
  };
  let layoutTunerState = null;
  let chatPanelState = null;
  let chatInputComposing = false;
  let chatPanelEnabled = false;
  let lastReportedPanelVisible = null;
  let chatPanelTransitionToken = 0;
  let chatPanelHideResizeTimer = null;
  let chatPanelShowResizeTimer = null;
  let chatPanelShowResizeListener = null;
  let layoutRafToken = 0;
  let lastReportedModelBounds = null;
  let detachWindowStateSync = null;
  const layoutTunerDefaults = window.DesktopLive2dDefaults?.DEFAULT_LAYOUT_CONFIG || {
    offsetX: 0,
    offsetY: 0,
    scaleMultiplier: 1
  };
  const modelTapToggleGate = typeof interactionApi?.createCooldownGate === 'function'
    ? interactionApi.createCooldownGate({ cooldownMs: 220 })
    : {
      tryEnter() {
        const now = Date.now();
        if (now < suppressModelTapUntil) {
          return false;
        }
        suppressModelTapUntil = now + 220;
        return true;
      }
    };
  const CHAT_PANEL_HIDE_RESIZE_DELAY_MS = 170;
  const CHAT_PANEL_SHOW_WAIT_RESIZE_TIMEOUT_MS = 220;
  const MODEL_TAP_SUPPRESS_AFTER_DRAG_MS = 220;
  const MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS = 240;
  const LIPSYNC_MOUTH_PARAM = 'ParamMouthOpenY';
  const LIPSYNC_MOUTH_FORM_PARAM = 'ParamMouthForm';
  const LIPSYNC_FFT_SIZE = 256;
  const LIPSYNC_THRESHOLD = 0.004;
  const LIPSYNC_RANGE = 0.06;
  const LIPSYNC_CURVE_EXPONENT = 0.65;
  const LIPSYNC_HARD_CLOSE_RMS_THRESHOLD = 0.014;
  const LIPSYNC_HARD_CLOSE_NORMALIZED_THRESHOLD = 0.14;
  const LIPSYNC_ATTACK_ALPHA = 0.56;
  const LIPSYNC_RELEASE_ALPHA = 0.18;
  const LIPSYNC_FORM_ATTACK_ALPHA = 0.42;
  const LIPSYNC_FORM_RELEASE_ALPHA = 0.22;
  const LIPSYNC_ACTIVE_BASELINE = 0.08;
  const LIPSYNC_SILENCE_HANGOVER_MS = 100;
  const LIPSYNC_MAX_MOUTH = 0.95;
  const LIPSYNC_FORM_MAX_ABS = 0.16;
  const LIPSYNC_FORM_DEADZONE = 0.18;
  const LIPSYNC_FORM_CURVE_EXPONENT = 0.82;
  const LIPSYNC_FORM_NEGATIVE_SCALE = 0.55;
  const LIPSYNC_FORM_POSITIVE_SCALE = 0.8;
  const LIPSYNC_FORM_LOW_BAND_HZ = [180, 900];
  const LIPSYNC_FORM_HIGH_BAND_HZ = [1200, 3600];
  const LIPSYNC_HARD_CLOSE_RELEASE_ALPHA = 0.34;
  const LIPSYNC_HARD_CLOSE_FORM_RELEASE_ALPHA = 0.3;
  const LIPSYNC_HARD_CLOSE_HANGOVER_MS = 110;
  const LIPSYNC_REST_OPEN_THRESHOLD = 0.012;
  const LIPSYNC_REST_FORM_THRESHOLD = 0.02;
  const VOICE_PLAYBACK_DEDUPE_WINDOW_MS = 3500;

  function nearlyEqual(left, right, epsilon = 1e-4) {
    if (typeof interactionApi?.nearlyEqual === 'function') {
      return interactionApi.nearlyEqual(left, right, epsilon);
    }
    const leftValue = Number(left);
    const rightValue = Number(right);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return false;
    }
    return Math.abs(leftValue - rightValue) <= Math.max(0, Number(epsilon) || 0);
  }

  function shouldUpdate2DTransform(currentX, currentY, nextX, nextY, epsilon = 1e-4) {
    if (typeof interactionApi?.shouldUpdate2D === 'function') {
      return interactionApi.shouldUpdate2D(currentX, currentY, nextX, nextY, epsilon);
    }
    return !(nearlyEqual(currentX, nextX, epsilon) && nearlyEqual(currentY, nextY, epsilon));
  }

  function cancelPendingChatPanelShow() {
    if (chatPanelShowResizeTimer) {
      clearTimeout(chatPanelShowResizeTimer);
      chatPanelShowResizeTimer = null;
    }
    if (chatPanelShowResizeListener) {
      window.removeEventListener('resize', chatPanelShowResizeListener);
      chatPanelShowResizeListener = null;
    }
  }

  function revealChatPanelAfterResize(token) {
    cancelPendingChatPanelShow();

    const reveal = () => {
      if (token !== chatPanelTransitionToken) {
        return;
      }
      window.requestAnimationFrame(() => {
        if (token !== chatPanelTransitionToken) {
          return;
        }
        chatPanelElement?.classList.add('visible');
      });
    };

    chatPanelShowResizeListener = () => {
      cancelPendingChatPanelShow();
      reveal();
    };
    window.addEventListener('resize', chatPanelShowResizeListener, { passive: true });
    chatPanelShowResizeTimer = setTimeout(() => {
      cancelPendingChatPanelShow();
      reveal();
    }, CHAT_PANEL_SHOW_WAIT_RESIZE_TIMEOUT_MS);
  }

  function createRpcError(code, message) {
    return { code, message };
  }

  function suppressModelTap(durationMs = MODEL_TAP_SUPPRESS_AFTER_DRAG_MS) {
    const duration = Number(durationMs);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : MODEL_TAP_SUPPRESS_AFTER_DRAG_MS;
    suppressModelTapUntil = Math.max(suppressModelTapUntil, Date.now() + safeDuration);
  }

  function setBubbleVisible(visible) {
    state.bubbleVisible = visible;
    bubbleElement.classList.toggle('visible', visible);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundToStep(value, step = 1) {
    const safeStep = Number(step) || 1;
    return Math.round((Number(value) || 0) / safeStep) * safeStep;
  }

  function normalizeMouthTunerValues(input = {}) {
    return {
      mouthOpen: Math.round(clamp(Number(input.mouthOpen) || 0, 0, 1) * 100) / 100,
      mouthForm: Math.round(clamp(Number(input.mouthForm) || 0, -1, 1) * 100) / 100
    };
  }

  function setMouthTunerStatus(message = '') {
    if (mouthTunerStatusElement) {
      mouthTunerStatusElement.textContent = String(message || '');
    }
  }

  function getMouthTunerRuntimeConfig() {
    const raw = runtimeUiConfig?.debug?.mouthTuner;
    const config = raw && typeof raw === 'object' ? raw : {};
    return {
      visible: config.visible === true,
      enabled: config.enabled === true
    };
  }

  function setMouthTunerVisible(visible) {
    const nextVisible = Boolean(visible);
    document.body.classList.toggle('mouth-tuner-visible', nextVisible);
    if (mouthTunerToggleElement) {
      mouthTunerToggleElement.hidden = !nextVisible;
    }
    if (mouthTunerPanelElement) {
      mouthTunerPanelElement.hidden = !nextVisible;
    }
    if (!nextVisible) {
      mouthTunerState.open = false;
      document.body.classList.remove('mouth-tuner-open');
    }
  }

  function syncMouthTunerControls() {
    const values = mouthTunerState?.values || normalizeMouthTunerValues();
    if (mouthTunerEnableElement) {
      mouthTunerEnableElement.checked = Boolean(mouthTunerState?.enabled);
    }
    if (mouthOpenElement) mouthOpenElement.value = values.mouthOpen.toFixed(2);
    if (mouthFormElement) mouthFormElement.value = values.mouthForm.toFixed(2);
    if (mouthOpenValueElement) mouthOpenValueElement.textContent = values.mouthOpen.toFixed(2);
    if (mouthFormValueElement) mouthFormValueElement.textContent = values.mouthForm.toFixed(2);
  }

  function setMouthTunerOpen(open) {
    if (!document.body.classList.contains('mouth-tuner-visible')) {
      mouthTunerState.open = false;
      document.body.classList.remove('mouth-tuner-open');
      return;
    }
    mouthTunerState.open = Boolean(open);
    document.body.classList.toggle('mouth-tuner-open', mouthTunerState.open);
  }

  function normalizeLayoutTunerValues(input = {}) {
    return {
      offsetX: Math.round(clamp(Number(input.offsetX) || 0, -120, 120)),
      offsetY: Math.round(clamp(Number(input.offsetY) || 0, -120, 120)),
      scaleMultiplier: Math.round(clamp(Number(input.scaleMultiplier) || 1, 0.7, 1.5) * 100) / 100
    };
  }

  function toLayoutDisplayValues(values = {}) {
    return {
      offsetX: Math.round((Number(values.offsetX) || 0) - (Number(layoutTunerDefaults.offsetX) || 0)),
      offsetY: Math.round((Number(values.offsetY) || 0) - (Number(layoutTunerDefaults.offsetY) || 0)),
      scaleMultiplier: Math.round((Number(values.scaleMultiplier) || 1) * 100) / 100
    };
  }

  function fromLayoutDisplayValues(values = {}) {
    return normalizeLayoutTunerValues({
      offsetX: (Number(layoutTunerDefaults.offsetX) || 0) + (Number(values.offsetX) || 0),
      offsetY: (Number(layoutTunerDefaults.offsetY) || 0) + (Number(values.offsetY) || 0),
      scaleMultiplier: Number(values.scaleMultiplier) || Number(layoutTunerDefaults.scaleMultiplier) || 1
    });
  }

  function ensureRuntimeLayoutConfig() {
    runtimeUiConfig = runtimeUiConfig && typeof runtimeUiConfig === 'object' ? runtimeUiConfig : {};
    runtimeUiConfig.layout = {
      ...(layoutTunerDefaults || {}),
      ...(runtimeUiConfig.layout || {})
    };
    return runtimeUiConfig.layout;
  }

  function getCurrentLayoutTunerValues() {
    const layoutConfig = ensureRuntimeLayoutConfig();
    return normalizeLayoutTunerValues({
      offsetX: layoutConfig.offsetX ?? layoutTunerDefaults.offsetX,
      offsetY: layoutConfig.offsetY ?? layoutTunerDefaults.offsetY,
      scaleMultiplier: layoutConfig.scaleMultiplier ?? layoutTunerDefaults.scaleMultiplier
    });
  }

  function setLayoutTunerStatus(message = '') {
    if (layoutTunerStatusElement) {
      layoutTunerStatusElement.textContent = String(message || '');
    }
  }

  function syncLayoutTunerControls() {
    if (!layoutTunerState?.values) {
      return;
    }
    const { offsetX, offsetY, scaleMultiplier } = toLayoutDisplayValues(layoutTunerState.values);
    if (layoutOffsetXElement) layoutOffsetXElement.value = String(offsetX);
    if (layoutOffsetYElement) layoutOffsetYElement.value = String(offsetY);
    if (layoutScaleElement) layoutScaleElement.value = String(scaleMultiplier);
    if (layoutOffsetXValueElement) layoutOffsetXValueElement.textContent = String(offsetX);
    if (layoutOffsetYValueElement) layoutOffsetYValueElement.textContent = String(offsetY);
    if (layoutScaleValueElement) layoutScaleValueElement.textContent = scaleMultiplier.toFixed(2);
  }

  function setLayoutTunerOpen(open) {
    const nextOpen = Boolean(open) && state.resizeModeEnabled;
    if (!layoutTunerState) {
      layoutTunerState = {
        open: nextOpen,
        values: getCurrentLayoutTunerValues()
      };
    } else {
      layoutTunerState.open = nextOpen;
    }
    document.body.classList.toggle('layout-tuner-open', nextOpen);
    if (layoutTunerToggleElement) {
      layoutTunerToggleElement.textContent = nextOpen ? 'Close Layout' : 'Adjust Layout';
    }
    if (!nextOpen) {
      setLayoutTunerStatus('');
    }
  }

  function applyLayoutTunerValues(nextValues, { showStatus = false, statusMessage = '' } = {}) {
    const normalized = normalizeLayoutTunerValues(nextValues);
    const layoutConfig = ensureRuntimeLayoutConfig();
    layoutConfig.offsetX = normalized.offsetX;
    layoutConfig.offsetY = normalized.offsetY;
    layoutConfig.scaleMultiplier = normalized.scaleMultiplier;
    if (!layoutTunerState) {
      layoutTunerState = { open: false, values: normalized };
    } else {
      layoutTunerState.values = normalized;
    }
    syncLayoutTunerControls();
    scheduleAdaptiveLayout();
    if (showStatus) {
      setLayoutTunerStatus(statusMessage);
    }
  }

  function resetLayoutTunerValues() {
    applyLayoutTunerValues({
      offsetX: layoutTunerDefaults.offsetX,
      offsetY: layoutTunerDefaults.offsetY,
      scaleMultiplier: layoutTunerDefaults.scaleMultiplier
    }, {
      showStatus: true,
      statusMessage: 'Preview reset to defaults'
    });
  }

  function saveLayoutTunerValues() {
    const values = layoutTunerState?.values || getCurrentLayoutTunerValues();
    bridge?.sendWindowControl?.({
      action: 'save_layout_overrides',
      layout: values
    });
    setLayoutTunerStatus('Saved to desktop-live2d.json');
  }

  function getCoreModel() {
    return live2dModel?.internalModel?.coreModel || null;
  }

  function getLipSyncParamMeta(parameterId) {
    const coreModel = getCoreModel();
    if (
      !coreModel
      || typeof coreModel.getParameterIndex !== 'function'
      || typeof coreModel.getParameterDefaultValue !== 'function'
      || typeof coreModel.getParameterMinimumValue !== 'function'
      || typeof coreModel.getParameterMaximumValue !== 'function'
    ) {
      return null;
    }

    if (!lipsyncParamMetaCache) {
      lipsyncParamMetaCache = new Map();
    }
    if (lipsyncParamMetaCache.has(parameterId)) {
      return lipsyncParamMetaCache.get(parameterId);
    }

    const parameterIndex = coreModel.getParameterIndex(parameterId);
    if (!Number.isInteger(parameterIndex) || parameterIndex < 0) {
      lipsyncParamMetaCache.set(parameterId, null);
      return null;
    }

    const meta = {
      defaultValue: Number(coreModel.getParameterDefaultValue(parameterIndex)),
      minValue: Number(coreModel.getParameterMinimumValue(parameterIndex)),
      maxValue: Number(coreModel.getParameterMaximumValue(parameterIndex))
    };
    lipsyncParamMetaCache.set(parameterId, meta);
    return meta;
  }

  function applyMouthOpenToModel(value) {
    if (!state.modelLoaded) {
      return { ok: false, skipped: true, reason: 'model_not_loaded' };
    }

    const coreModel = getCoreModel();
    if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
      return { ok: false, skipped: true, reason: 'core_model_unavailable' };
    }

    coreModel.setParameterValueById(LIPSYNC_MOUTH_PARAM, clamp(Number(value) || 0, 0, 1));
    return { ok: true };
  }

  function setMouthOpen(value) {
    lipsyncCurrentMouthOpen = clamp(Number(value) || 0, 0, 1);
    return applyMouthOpenToModel(lipsyncCurrentMouthOpen);
  }

  function applyMouthFormToModel(value) {
    if (!state.modelLoaded) {
      return { ok: false, skipped: true, reason: 'model_not_loaded' };
    }

    const coreModel = getCoreModel();
    if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
      return { ok: false, skipped: true, reason: 'core_model_unavailable' };
    }

    const normalizedValue = clamp(Number(value) || 0, -1, 1);
    const meta = getLipSyncParamMeta(LIPSYNC_MOUTH_FORM_PARAM);
    if (!meta) {
      coreModel.setParameterValueById(
        LIPSYNC_MOUTH_FORM_PARAM,
        clamp(normalizedValue * LIPSYNC_FORM_MAX_ABS, -LIPSYNC_FORM_MAX_ABS, LIPSYNC_FORM_MAX_ABS)
      );
      return { ok: true, calibrated: false };
    }

    const positiveSpan = Math.max(0, Math.min(meta.maxValue - meta.defaultValue, LIPSYNC_FORM_MAX_ABS));
    const negativeSpan = Math.max(0, Math.min(meta.defaultValue - meta.minValue, LIPSYNC_FORM_MAX_ABS));
    const delta = normalizedValue >= 0
      ? normalizedValue * positiveSpan
      : normalizedValue * negativeSpan;
    const calibratedValue = clamp(meta.defaultValue + delta, meta.minValue, meta.maxValue);

    coreModel.setParameterValueById(LIPSYNC_MOUTH_FORM_PARAM, calibratedValue);
    return { ok: true };
  }

  function applyDebugMouthTunerForCurrentFrame() {
    if (!mouthTunerState?.enabled) {
      return;
    }
    const values = mouthTunerState.values || { mouthOpen: 0, mouthForm: 0 };
    applyMouthOpenToModel(values.mouthOpen);
    applyMouthFormToModel(values.mouthForm);
  }

  function applyExternalMouthOverrideForCurrentFrame() {
    if (!externalMouthOverrideState?.enabled) {
      return;
    }
    const values = externalMouthOverrideState.values || { mouthOpen: 0, mouthForm: 0 };
    applyMouthOpenToModel(values.mouthOpen);
    applyMouthFormToModel(values.mouthForm);
  }

  function applyNeutralMouthPoseForCurrentFrame() {
    applyMouthOpenToModel(0);
    applyMouthFormToModel(0);
  }

  function setMouthForm(value) {
    lipsyncCurrentMouthForm = clamp(Number(value) || 0, -1, 1);
    return applyMouthFormToModel(lipsyncCurrentMouthForm);
  }

  function getFrequencyBandEnergy(buffer, sampleRate, minHz, maxHz) {
    if (!buffer || !buffer.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return 0;
    }

    const nyquist = sampleRate / 2;
    const minIndex = clamp(Math.floor((minHz / nyquist) * buffer.length), 0, buffer.length - 1);
    const maxIndex = clamp(Math.ceil((maxHz / nyquist) * buffer.length), minIndex + 1, buffer.length);
    let sum = 0;
    let count = 0;
    for (let index = minIndex; index < maxIndex; index += 1) {
      sum += buffer[index] / 255;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }

  function applyLipSyncForCurrentFrame() {
    if (lipsyncCurrentMouthOpen <= 0 && Math.abs(lipsyncCurrentMouthForm) <= 1e-4) {
      return;
    }

    const coreModel = getCoreModel();
    if (!coreModel) {
      return;
    }

    if (typeof coreModel.addParameterValueById === 'function') {
      coreModel.addParameterValueById(LIPSYNC_MOUTH_PARAM, lipsyncCurrentMouthOpen, 1);
      applyMouthFormToModel(lipsyncCurrentMouthForm);
      const now = Date.now();
      if (now - lastLipSyncDebugLogAt >= 1000 && typeof coreModel.getParameterValueById === 'function') {
        const formMeta = getLipSyncParamMeta(LIPSYNC_MOUTH_FORM_PARAM);
        lastLipSyncDebugLogAt = now;
        console.log('[lipsync] apply frame', JSON.stringify({
          source: 'beforeModelUpdate',
          target: lipsyncCurrentMouthOpen,
          current: coreModel.getParameterValueById(LIPSYNC_MOUTH_PARAM),
          form_target: lipsyncCurrentMouthForm,
          form_current: coreModel.getParameterValueById(LIPSYNC_MOUTH_FORM_PARAM),
          form_default: formMeta?.defaultValue ?? null,
          form_min: formMeta?.minValue ?? null,
          form_max: formMeta?.maxValue ?? null,
          viseme: lipsyncLastVisemeFrame?.dominantViseme ?? null,
          viseme_confidence: lipsyncLastVisemeFrame?.confidence ?? null,
          viseme_weights: lipsyncLastVisemeFrame?.weights ?? null
        }));
      }
      return;
    }

    applyMouthOpenToModel(lipsyncCurrentMouthOpen);
    applyMouthFormToModel(lipsyncCurrentMouthForm);
  }

  function bindLipSyncTicker() {
    if (!pixiApp?.ticker || typeof pixiApp.ticker.add !== 'function' || detachLipSyncTicker) {
      return;
    }

    const tick = () => {
      if (externalMouthOverrideState?.enabled) {
        applyExternalMouthOverrideForCurrentFrame();
        return;
      }
      if (mouthTunerState?.enabled) {
        applyDebugMouthTunerForCurrentFrame();
        return;
      }
      if (lipsyncCurrentMouthOpen > 0 || Math.abs(lipsyncCurrentMouthForm) > 1e-4) {
        applyLipSyncForCurrentFrame();
        return;
      }
      applyNeutralMouthPoseForCurrentFrame();
    };

    pixiApp.ticker.add(tick);
    detachLipSyncTicker = () => {
      if (pixiApp?.ticker && typeof pixiApp.ticker.remove === 'function') {
        pixiApp.ticker.remove(tick);
      }
      detachLipSyncTicker = null;
    };
  }

  function bindLipSyncModelHook() {
    const internalModel = live2dModel?.internalModel;
    if (!internalModel || typeof internalModel.on !== 'function' || detachLipSyncModelHook) {
      return false;
    }

    const handler = () => {
      if (externalMouthOverrideState?.enabled) {
        applyExternalMouthOverrideForCurrentFrame();
        return;
      }
      if (mouthTunerState?.enabled) {
        applyDebugMouthTunerForCurrentFrame();
        return;
      }
      if (lipsyncCurrentMouthOpen > 0 || Math.abs(lipsyncCurrentMouthForm) > 1e-4) {
        applyLipSyncForCurrentFrame();
        return;
      }
      applyNeutralMouthPoseForCurrentFrame();
    };

    internalModel.on('beforeModelUpdate', handler);
    detachLipSyncModelHook = () => {
      if (typeof internalModel.off === 'function') {
        internalModel.off('beforeModelUpdate', handler);
      } else if (typeof internalModel.removeListener === 'function') {
        internalModel.removeListener('beforeModelUpdate', handler);
      }
      detachLipSyncModelHook = null;
    };
    return true;
  }

  function computeRmsFromTimeDomain(buffer) {
    if (!buffer || buffer.length === 0) {
      return 0;
    }

    let sumSquares = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const normalized = (buffer[index] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / buffer.length);
  }

  async function ensureLipSyncGraph(audioEl) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw createRpcError(-32005, 'AudioContext is unavailable');
    }

    if (!lipsyncCtx || lipsyncCtx.state === 'closed') {
      lipsyncCtx = new AudioContextCtor();
      lipsyncAnalyser = null;
      lipsyncSource = null;
      lipsyncAudioEl = null;
      lipsyncTimeDomainBuffer = null;
      lipsyncFrequencyBuffer = null;
    }

    if (lipsyncCtx.state === 'suspended') {
      await lipsyncCtx.resume();
    }

    if (!lipsyncAnalyser) {
      lipsyncAnalyser = lipsyncCtx.createAnalyser();
      lipsyncAnalyser.fftSize = LIPSYNC_FFT_SIZE;
      lipsyncTimeDomainBuffer = new Uint8Array(lipsyncAnalyser.fftSize);
      lipsyncFrequencyBuffer = new Uint8Array(lipsyncAnalyser.frequencyBinCount);
    }

    if (!lipsyncSource) {
      lipsyncSource = lipsyncCtx.createMediaElementSource(audioEl);
      lipsyncAudioEl = audioEl;
      lipsyncSource.connect(lipsyncAnalyser);
      lipsyncAnalyser.connect(lipsyncCtx.destination);
    } else if (lipsyncAudioEl !== audioEl) {
      throw createRpcError(-32005, 'lip sync source is already bound to another audio element');
    }

    return {
      ctx: lipsyncCtx,
      analyser: lipsyncAnalyser,
      buffer: lipsyncTimeDomainBuffer,
      frequencyBuffer: lipsyncFrequencyBuffer
    };
  }

  function teardownLipSyncPlaybackListeners() {
    if (typeof detachLipSyncPlaybackListeners === 'function') {
      detachLipSyncPlaybackListeners();
      detachLipSyncPlaybackListeners = null;
    }
  }

  function stopLipSyncFrame() {
    if (lipsyncRafId) {
      window.cancelAnimationFrame(lipsyncRafId);
      lipsyncRafId = 0;
    }
    lipsyncSmoothed = 0;
    lipsyncSmoothedForm = 0;
    lipsyncCurrentMouthOpen = 0;
    lipsyncCurrentMouthForm = 0;
    lipsyncLastVoiceAt = 0;
    lipsyncVisemeState = visemeLipSyncApi?.createRuntimeState?.() || null;
    lipsyncLastVisemeFrame = null;
    setMouthOpen(0);
    setMouthForm(0);
  }

  function stopLipSync() {
    stopLipSyncFrame();
    teardownLipSyncPlaybackListeners();
  }

  async function startLipSyncWithAudio(audioEl) {
    const graph = await ensureLipSyncGraph(audioEl);
    stopLipSyncFrame();

    const step = () => {
      if (!graph.analyser || !graph.buffer || !graph.frequencyBuffer) {
        return;
      }

      graph.analyser.getByteTimeDomainData(graph.buffer);
      graph.analyser.getByteFrequencyData(graph.frequencyBuffer);
      const rms = computeRmsFromTimeDomain(graph.buffer);
      const now = performance.now();
      const normalized = rms <= LIPSYNC_THRESHOLD
        ? 0
        : clamp((rms - LIPSYNC_THRESHOLD) / LIPSYNC_RANGE, 0, 1);
      const hardSilent = rms < LIPSYNC_HARD_CLOSE_RMS_THRESHOLD || normalized < LIPSYNC_HARD_CLOSE_NORMALIZED_THRESHOLD;
      const recentVoice = lipsyncLastVoiceAt > 0 && now - lipsyncLastVoiceAt <= LIPSYNC_HARD_CLOSE_HANGOVER_MS;
      if (hardSilent) {
        if (
          recentVoice
          || lipsyncSmoothed > LIPSYNC_REST_OPEN_THRESHOLD
          || Math.abs(lipsyncSmoothedForm) > LIPSYNC_REST_FORM_THRESHOLD
        ) {
          lipsyncSmoothed += (0 - lipsyncSmoothed) * LIPSYNC_HARD_CLOSE_RELEASE_ALPHA;
          lipsyncSmoothedForm += (0 - lipsyncSmoothedForm) * LIPSYNC_HARD_CLOSE_FORM_RELEASE_ALPHA;
          setMouthOpen(lipsyncSmoothed);
          setMouthForm(lipsyncSmoothedForm);
          lipsyncRafId = window.requestAnimationFrame(step);
          return;
        }

        lipsyncSmoothed = 0;
        lipsyncSmoothedForm = 0;
        lipsyncLastVoiceAt = 0;
        lipsyncLastVisemeFrame = null;
        lipsyncVisemeState = visemeLipSyncApi?.createRuntimeState?.() || null;
        setMouthOpen(0);
        setMouthForm(0);
        lipsyncRafId = window.requestAnimationFrame(step);
        return;
      }
      let target = 0;
      if (normalized > 0) {
        lipsyncLastVoiceAt = now;
        const shaped = Math.pow(normalized, LIPSYNC_CURVE_EXPONENT);
        target = LIPSYNC_ACTIVE_BASELINE + shaped * (LIPSYNC_MAX_MOUTH - LIPSYNC_ACTIVE_BASELINE);
      } else if (lipsyncLastVoiceAt > 0 && now - lipsyncLastVoiceAt <= LIPSYNC_SILENCE_HANGOVER_MS) {
        target = LIPSYNC_ACTIVE_BASELINE;
      }

      const smoothingAlpha = target > lipsyncSmoothed ? LIPSYNC_ATTACK_ALPHA : LIPSYNC_RELEASE_ALPHA;
      lipsyncSmoothed += (target - lipsyncSmoothed) * smoothingAlpha;
      const lowBandEnergy = getFrequencyBandEnergy(
        graph.frequencyBuffer,
        graph.ctx?.sampleRate || 0,
        LIPSYNC_FORM_LOW_BAND_HZ[0],
        LIPSYNC_FORM_LOW_BAND_HZ[1]
      );
      const highBandEnergy = getFrequencyBandEnergy(
        graph.frequencyBuffer,
        graph.ctx?.sampleRate || 0,
        LIPSYNC_FORM_HIGH_BAND_HZ[0],
        LIPSYNC_FORM_HIGH_BAND_HZ[1]
      );
      const spectralBalance = clamp(
        (highBandEnergy - lowBandEnergy) / Math.max(1e-4, highBandEnergy + lowBandEnergy),
        -1,
        1
      );
      const mouthOpenWeight = clamp((lipsyncSmoothed - LIPSYNC_ACTIVE_BASELINE) / Math.max(1e-4, LIPSYNC_MAX_MOUTH), 0, 1);
      const spectralMagnitude = Math.abs(spectralBalance);
      const normalizedFormMagnitude = spectralMagnitude <= LIPSYNC_FORM_DEADZONE
        ? 0
        : clamp((spectralMagnitude - LIPSYNC_FORM_DEADZONE) / Math.max(1e-4, 1 - LIPSYNC_FORM_DEADZONE), 0, 1);
      const shapedFormBalance = Math.sign(spectralBalance) * Math.pow(normalizedFormMagnitude, LIPSYNC_FORM_CURVE_EXPONENT);
      const directionalFormScale = shapedFormBalance < 0 ? LIPSYNC_FORM_NEGATIVE_SCALE : LIPSYNC_FORM_POSITIVE_SCALE;
      const fallbackFormTarget = shapedFormBalance * mouthOpenWeight * directionalFormScale;
      const formSmoothingAlpha = Math.abs(fallbackFormTarget) > Math.abs(lipsyncSmoothedForm)
        ? LIPSYNC_FORM_ATTACK_ALPHA
        : LIPSYNC_FORM_RELEASE_ALPHA;
      lipsyncSmoothedForm += (fallbackFormTarget - lipsyncSmoothedForm) * formSmoothingAlpha;

      let nextMouthOpen = lipsyncSmoothed;
      let nextMouthForm = lipsyncSmoothedForm;
      const visemeFrame = visemeLipSyncApi?.resolveVisemeFrame?.({
        frequencyBuffer: graph.frequencyBuffer,
        sampleRate: graph.ctx?.sampleRate || 0,
        voiceEnergy: normalized,
        speaking: normalized > 0 || target > 0,
        fallbackOpen: lipsyncSmoothed,
        fallbackForm: lipsyncSmoothedForm,
        state: lipsyncVisemeState
      }) || null;
      if (visemeFrame) {
        lipsyncLastVisemeFrame = visemeFrame;
        nextMouthOpen = clamp(Number(visemeFrame.mouthOpen) || 0, 0, 1);
        nextMouthForm = clamp(Number(visemeFrame.mouthForm) || 0, -1, 1);
      } else {
        lipsyncLastVisemeFrame = null;
      }

      setMouthOpen(nextMouthOpen);
      setMouthForm(nextMouthForm);
      lipsyncRafId = window.requestAnimationFrame(step);
    };

    step();
  }

  function normalizeFileUrl(rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
      return '';
    }
    if (/^(file|https?|data|blob):/i.test(normalized)) {
      return normalized;
    }
    if (normalized.startsWith('/')) {
      return `file://${encodeURI(normalized)}`;
    }
    return '';
  }

  function resolveAudioPlaybackUrl(data = {}) {
    const directRef = normalizeFileUrl(data.audio_ref || data.audioRef || data.audioPath);
    if (directRef) {
      return directRef;
    }

    const gatewayUrl = String(data.gatewayUrl || '').trim();
    const audioRef = String(data.audio_ref || data.audioRef || '').trim();
    if (gatewayUrl && audioRef) {
      try {
        const url = new URL('/api/audio', gatewayUrl);
        url.searchParams.set('path', audioRef);
        return url.toString();
      } catch {
        return '';
      }
    }

    return '';
  }

  function buildVoicePlaybackKey(payload = {}, audioUrl = '') {
    const idempotencyKey = String(payload.idempotencyKey || payload.idempotency_key || '').trim();
    if (idempotencyKey) {
      return `idem:${idempotencyKey}`;
    }

    const turnId = String(payload.turnId || payload.turn_id || '').trim();
    if (turnId && audioUrl) {
      return `turn:${turnId}|url:${audioUrl}`;
    }
    if (turnId) {
      return `turn:${turnId}`;
    }

    return audioUrl ? `url:${audioUrl}` : '';
  }

  function shouldSkipDuplicateVoicePlayback(playbackKey) {
    if (!playbackKey) {
      return false;
    }

    const now = Date.now();
    for (const [key, timestamp] of recentVoicePlaybackKeys.entries()) {
      if (!Number.isFinite(timestamp) || now - timestamp > VOICE_PLAYBACK_DEDUPE_WINDOW_MS) {
        recentVoicePlaybackKeys.delete(key);
      }
    }

    const previousSeenAt = recentVoicePlaybackKeys.get(playbackKey);
    if (Number.isFinite(previousSeenAt) && now - previousSeenAt <= VOICE_PLAYBACK_DEDUPE_WINDOW_MS) {
      return true;
    }

    recentVoicePlaybackKeys.set(playbackKey, now);
    return false;
  }

  async function playAudioWithLipSync(audioUrl) {
    if (!audioUrl) {
      throw createRpcError(-32602, 'audio url is required for lip sync playback');
    }

    stopLipSync();
    try {
      systemAudio.pause();
    } catch {
      // no-op
    }

    systemAudio.currentTime = 0;
    const previousAutoplay = systemAudio.autoplay;
    systemAudio.autoplay = false;
    systemAudio.src = audioUrl;
    systemAudio.load();

    const onPlaybackFinished = () => {
      stopLipSync();
      systemAudio.autoplay = previousAutoplay;
    };
    systemAudio.addEventListener('ended', onPlaybackFinished);
    systemAudio.addEventListener('pause', onPlaybackFinished);
    systemAudio.addEventListener('error', onPlaybackFinished);
    detachLipSyncPlaybackListeners = () => {
      systemAudio.removeEventListener('ended', onPlaybackFinished);
      systemAudio.removeEventListener('pause', onPlaybackFinished);
      systemAudio.removeEventListener('error', onPlaybackFinished);
      systemAudio.autoplay = previousAutoplay;
    };

    await ensureLipSyncGraph(systemAudio);
    await systemAudio.play();
    await startLipSyncWithAudio(systemAudio);

    return { ok: true, audioUrl };
  }

  async function handleVoicePlaybackRequest(payload = {}) {
    const audioUrl = resolveAudioPlaybackUrl(payload);
    if (!audioUrl) {
      throw createRpcError(-32602, 'voice playback requires audio_ref, audioRef, or audioPath');
    }
    const playbackKey = buildVoicePlaybackKey(payload, audioUrl);
    if (shouldSkipDuplicateVoicePlayback(playbackKey)) {
      console.log('[lipsync] skip duplicate voice playback', JSON.stringify({
        playbackKey,
        turnId: payload.turnId || payload.turn_id || null,
        idempotencyKey: payload.idempotencyKey || payload.idempotency_key || null
      }));
      return { ok: true, deduplicated: true, audioUrl };
    }
    return playAudioWithLipSync(audioUrl);
  }

  async function handleVoicePlaybackMemoryRequest(payload = {}) {
    const audioBase64 = String(payload.audioBase64 || '').trim();
    if (!audioBase64) {
      throw createRpcError(-32602, 'voice playback memory requires audioBase64');
    }
    const mimeType = String(payload.mimeType || payload.mime_type || 'audio/ogg');
    const requestId = String(payload.requestId || payload.request_id || `${Date.now()}-voice`);
    
    const playbackKey = buildVoicePlaybackKey({
      idempotencyKey: requestId,
      turnId: payload.turnId || payload.turn_id
    }, `blob:memory:${requestId}`);
    
    if (shouldSkipDuplicateVoicePlayback(playbackKey)) {
      console.log('[lipsync] skip duplicate voice playback (memory)', JSON.stringify({
        playbackKey,
        requestId
      }));
      return { ok: true, deduplicated: true, requestId };
    }
    
    const binaryString = atob(audioBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    releaseCurrentVoiceObjectUrl();
    const blob = new Blob([bytes], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    currentVoiceObjectUrl = objectUrl;
    
    return playAudioWithLipSync(objectUrl);
  }

  function releaseCurrentVoiceObjectUrl() {
    if (currentVoiceObjectUrl) {
      try {
        URL.revokeObjectURL(currentVoiceObjectUrl);
      } catch {
        // ignore revoke errors
      }
      currentVoiceObjectUrl = null;
    }
  }

  function positionBubbleNearModelHead() {
    if (!bubbleLayerElement || !bubbleElement) {
      return;
    }

    const stageSize = getStageSize();
    const bubbleWidth = Math.max(120, bubbleElement.offsetWidth || 260);
    const bubbleHeight = Math.max(36, bubbleElement.offsetHeight || 84);
    const margin = 10;

    let anchorX = stageSize.width * 0.46;
    let anchorY = stageSize.height * 0.2;
    const modelBounds = live2dModel?.getBounds?.();
    if (
      modelBounds
      && Number.isFinite(modelBounds.x)
      && Number.isFinite(modelBounds.y)
      && Number.isFinite(modelBounds.width)
      && Number.isFinite(modelBounds.height)
      && modelBounds.width > 1
      && modelBounds.height > 1
    ) {
      anchorX = modelBounds.x + modelBounds.width * 0.28;
      anchorY = modelBounds.y + modelBounds.height * 0.14;
    }

    const nextLeft = clamp(anchorX - bubbleWidth - 12, margin, stageSize.width - bubbleWidth - margin);
    const nextTop = clamp(anchorY - bubbleHeight - 14, margin, stageSize.height - bubbleHeight - margin);
    bubbleLayerElement.style.left = `${Math.round(nextLeft)}px`;
    bubbleLayerElement.style.top = `${Math.round(nextTop)}px`;
  }

  function syncChatStateSummary() {
    state.chatPanelVisible = Boolean(chatPanelEnabled && chatPanelState?.visible);
    state.chatHistorySize = Array.isArray(chatPanelState?.messages) ? chatPanelState.messages.length : 0;
  }

  function assertChatPanelEnabled() {
    if (!chatPanelEnabled || !chatPanelState) {
      throw createRpcError(-32005, 'chat panel is disabled');
    }
  }

  function renderChatMessages() {
    if (!chatPanelMessagesElement || !chatPanelState) {
      return;
    }

    chatPanelMessagesElement.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const message of chatPanelState.messages) {
      const node = document.createElement('div');
      node.className = `chat-message ${message.role}`;
      node.textContent = message.text;
      fragment.appendChild(node);
    }
    chatPanelMessagesElement.appendChild(fragment);
    chatPanelMessagesElement.scrollTop = chatPanelMessagesElement.scrollHeight;

    syncChatStateSummary();
  }

  function applyChatPanelVisibility() {
    const visible = Boolean(chatPanelEnabled && chatPanelState?.visible);
    const token = ++chatPanelTransitionToken;

    if (chatPanelHideResizeTimer) {
      clearTimeout(chatPanelHideResizeTimer);
      chatPanelHideResizeTimer = null;
    }
    cancelPendingChatPanelShow();

    if (visible) {
      if (typeof bridge?.sendChatPanelVisibility === 'function' && lastReportedPanelVisible !== true) {
        bridge.sendChatPanelVisibility({ visible: true });
        lastReportedPanelVisible = true;
      }
      // Wait for resize (or timeout fallback) before reveal to avoid one-frame flicker.
      revealChatPanelAfterResize(token);
    } else {
      chatPanelElement?.classList.remove('visible');
      // Wait panel fade-out before shrinking the host window to keep transition smooth.
      chatPanelHideResizeTimer = setTimeout(() => {
        if (token !== chatPanelTransitionToken) {
          return;
        }
        if (typeof bridge?.sendChatPanelVisibility === 'function' && lastReportedPanelVisible !== false) {
          bridge.sendChatPanelVisibility({ visible: false });
          lastReportedPanelVisible = false;
        }
        chatPanelHideResizeTimer = null;
      }, CHAT_PANEL_HIDE_RESIZE_DELAY_MS);
    }
    syncChatStateSummary();
  }

  function setChatPanelVisible(visible) {
    assertChatPanelEnabled();
    const nextVisible = Boolean(visible);
    if (Boolean(chatPanelState?.visible) === nextVisible) {
      return { ok: true, visible: nextVisible };
    }
    chatPanelState = chatStateApi.setPanelVisible(chatPanelState, visible);
    applyChatPanelVisibility();
    return { ok: true, visible: chatPanelState.visible };
  }

  function toggleChatPanelVisible() {
    if (!chatPanelEnabled || !chatPanelState) {
      return { ok: false, visible: false };
    }
    return setChatPanelVisible(!chatPanelState.visible);
  }

  function appendChatMessage(params, fallbackRole = 'assistant') {
    assertChatPanelEnabled();
    chatPanelState = chatStateApi.appendMessage(chatPanelState, params, fallbackRole);
    renderChatMessages();
    return { ok: true, count: chatPanelState.messages.length };
  }

  function clearChatMessages() {
    assertChatPanelEnabled();
    chatPanelState = chatStateApi.clearMessages(chatPanelState);
    renderChatMessages();
    return { ok: true, count: 0 };
  }

  function showBubble(params) {
    const text = String(params?.text || '').trim();
    if (!text) {
      throw createRpcError(-32602, 'chat.show requires non-empty text');
    }

    const durationMs = Number.isFinite(Number(params?.durationMs))
      ? Math.max(500, Math.min(30000, Number(params.durationMs)))
      : 5000;

    bubbleElement.textContent = text;
    setBubbleVisible(true);
    window.requestAnimationFrame(() => {
      positionBubbleNearModelHead();
    });

    if (hideBubbleTimer) {
      clearTimeout(hideBubbleTimer);
    }
    hideBubbleTimer = setTimeout(() => {
      setBubbleVisible(false);
      hideBubbleTimer = null;
    }, durationMs);

    if (runtimeUiConfig?.chat?.bubble?.mirrorToPanel && chatPanelEnabled) {
      appendChatMessage(
        {
          role: String(params?.role || 'assistant'),
          text,
          timestamp: Date.now(),
          requestId: params?.requestId
        },
        'assistant'
      );
    }

    return { ok: true, expiresAt: Date.now() + durationMs };
  }

  function setModelParam(params) {
    if (!live2dModel || !state.modelLoaded) {
      throw createRpcError(-32004, 'model not loaded');
    }

    const name = String(params?.name || '').trim();
    const value = Number(params?.value);
    if (!name || !Number.isFinite(value)) {
      throw createRpcError(-32602, 'param.set requires { name, value:number }');
    }

    const coreModel = live2dModel.internalModel?.coreModel;
    if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
      throw createRpcError(-32005, 'setParameterValueById is unavailable on this model runtime');
    }

    coreModel.setParameterValueById(name, value);
    return { ok: true };
  }

  function setModelParamsBatch(params) {
    const updates = Array.isArray(params?.updates) ? params.updates : [];
    if (updates.length === 0) {
      throw createRpcError(-32602, 'model.param.batchSet requires non-empty updates array');
    }

    for (const update of updates) {
      setModelParam(update);
    }
    return {
      ok: true,
      applied: updates.length
    };
  }

  function ensureActionExecutionMutex() {
    if (actionExecutionMutex) {
      return actionExecutionMutex;
    }

    if (typeof actionMutexApi?.createLive2dActionMutex === 'function') {
      actionExecutionMutex = actionMutexApi.createLive2dActionMutex();
      return actionExecutionMutex;
    }

    actionExecutionMutex = {
      runExclusive: async (task) => task()
    };
    return actionExecutionMutex;
  }

  async function runActionWithMutex(task) {
    const mutex = ensureActionExecutionMutex();
    if (!mutex || typeof mutex.runExclusive !== 'function') {
      return task();
    }
    return mutex.runExclusive(task);
  }

  function playModelMotionRaw(params) {
    if (!live2dModel || !state.modelLoaded) {
      throw createRpcError(-32004, 'model not loaded');
    }

    const group = String(params?.group || '').trim();
    if (!group) {
      throw createRpcError(-32602, 'model.motion.play requires non-empty group');
    }

    const hasIndex = params && Object.prototype.hasOwnProperty.call(params, 'index');
    const index = Number(params?.index);
    if (hasIndex && !Number.isInteger(index)) {
      throw createRpcError(-32602, 'model.motion.play index must be integer');
    }

    if (typeof live2dModel.motion !== 'function') {
      throw createRpcError(-32005, 'motion() is unavailable on this model runtime');
    }

    if (hasIndex) {
      live2dModel.motion(group, index);
    } else {
      live2dModel.motion(group);
    }

    return {
      ok: true,
      group,
      index: hasIndex ? index : null
    };
  }

  function setModelExpressionRaw(params) {
    if (!live2dModel || !state.modelLoaded) {
      throw createRpcError(-32004, 'model not loaded');
    }

    const name = String(params?.name || '').trim();
    if (!name) {
      throw createRpcError(-32602, 'model.expression.set requires non-empty name');
    }

    if (typeof live2dModel.expression === 'function') {
      live2dModel.expression(name);
      return { ok: true, name };
    }

    const expressionManager = live2dModel.internalModel?.motionManager?.expressionManager;
    if (expressionManager && typeof expressionManager.setExpression === 'function') {
      expressionManager.setExpression(name);
      return { ok: true, name };
    }

    throw createRpcError(-32005, 'expression() is unavailable on this model runtime');
  }

  function resetModelExpressionRaw() {
    if (!live2dModel || !state.modelLoaded) {
      return { ok: false, skipped: true, reason: 'model_not_loaded' };
    }

    if (typeof live2dModel.resetExpression === 'function') {
      live2dModel.resetExpression();
      return { ok: true };
    }

    const expressionManager = live2dModel.internalModel?.motionManager?.expressionManager;
    if (expressionManager && typeof expressionManager.resetExpression === 'function') {
      expressionManager.resetExpression();
      return { ok: true };
    }

    return { ok: false, skipped: true, reason: 'reset_expression_unavailable' };
  }

  async function playModelMotion(params) {
    return runActionWithMutex(() => playModelMotionRaw(params));
  }

  async function setModelExpression(params) {
    return runActionWithMutex(() => setModelExpressionRaw(params));
  }

  function ensureActionQueuePlayer() {
    if (actionQueuePlayer) {
      return actionQueuePlayer;
    }
    const Player = actionQueueApi?.Live2dActionQueuePlayer;
    if (typeof Player !== 'function') {
      throw createRpcError(-32005, 'Live2dActionQueuePlayer runtime is unavailable');
    }
    if (!actionExecutor) {
      if (typeof actionExecutorApi?.createLive2dActionExecutor !== 'function') {
        throw createRpcError(-32005, 'Live2dActionExecutor runtime is unavailable');
      }
      const runtimeActionQueueConfig = runtimeUiConfig?.actionQueue || {};
      const idleAction = runtimeActionQueueConfig.idleFallbackEnabled === false
        ? null
        : (runtimeActionQueueConfig.idleAction || null);
      actionExecutor = actionExecutorApi.createLive2dActionExecutor({
        setExpression: setModelExpressionRaw,
        playMotion: playModelMotionRaw,
        setParamBatch: setModelParamsBatch,
        presetConfig: runtimeLive2dPresets || {},
        createError: createRpcError
      });
      actionQueuePlayer = new Player({
        executeAction: async (action) => {
          await actionExecutor(action);
        },
        afterIdleAction: async () => {
          resetModelExpressionRaw();
        },
        maxQueueSize: Number(runtimeActionQueueConfig.maxQueueSize) || 120,
        overflowPolicy: runtimeActionQueueConfig.overflowPolicy || 'drop_oldest',
        idleAction,
        mutex: ensureActionExecutionMutex(),
        onTelemetry: (payload) => {
          bridge?.sendActionTelemetry?.(payload);
        },
        logger: console
      });
      return actionQueuePlayer;
    }
    throw createRpcError(-32005, 'live2d action subsystem init failed');
  }

  function getState() {
    syncChatStateSummary();
    return {
      modelLoaded: state.modelLoaded,
      modelName: state.modelName,
      bubbleVisible: state.bubbleVisible,
      chatPanelVisible: state.chatPanelVisible,
      chatHistorySize: state.chatHistorySize,
      lastError: state.lastError,
      layout: state.layout,
      windowState: state.windowState,
      resizeModeEnabled: state.resizeModeEnabled,
      debug: {
        mouthOverride: {
          enabled: Boolean(externalMouthOverrideState?.enabled),
          values: normalizeMouthTunerValues(externalMouthOverrideState?.values || {})
        }
      }
    };
  }

  function applyWindowState(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    state.windowState = {
      width: Number(payload.width) || null,
      height: Number(payload.height) || null,
      x: Number(payload.x) || null,
      y: Number(payload.y) || null,
      minWidth: Number(payload.minWidth) || null,
      minHeight: Number(payload.minHeight) || null,
      maxWidth: Number(payload.maxWidth) || null,
      maxHeight: Number(payload.maxHeight) || null,
      defaultWidth: Number(payload.defaultWidth) || null,
      defaultHeight: Number(payload.defaultHeight) || null,
      aspectRatio: Number(payload.aspectRatio) || null
    };
    state.resizeModeEnabled = payload?.resizeModeEnabled === true;
    document.body.classList.toggle('resize-mode-active', state.resizeModeEnabled);
    const baseWidth = Number(state.windowState.defaultWidth) || Number(state.windowState.width) || null;
    const baseHeight = Number(state.windowState.defaultHeight) || Number(state.windowState.height) || null;
    const currentWidth = Number(state.windowState.width) || baseWidth;
    const currentHeight = Number(state.windowState.height) || baseHeight;
    if (Number.isFinite(baseWidth) && baseWidth > 0 && Number.isFinite(baseHeight) && baseHeight > 0) {
      const nextScaleFactor = Math.max(currentWidth / baseWidth, currentHeight / baseHeight);
      if (Number.isFinite(nextScaleFactor) && nextScaleFactor > 0) {
        resizeModeScaleFactor = nextScaleFactor;
      }
    }
    if (!state.resizeModeEnabled) {
      resizeModeScaleFactor = 1;
      lastResizeModeRequest = null;
      setLayoutTunerOpen(false);
    }
  }

  function requestWindowResize(payload = {}) {
    bridge?.sendWindowResize?.(payload);
  }

  function initLayoutTuner() {
    layoutTunerState = {
      open: false,
      values: getCurrentLayoutTunerValues()
    };
    syncLayoutTunerControls();
    setLayoutTunerOpen(false);

    layoutTunerToggleElement?.addEventListener('click', () => {
      setLayoutTunerOpen(!layoutTunerState?.open);
    });
    layoutTunerCloseElement?.addEventListener('click', () => {
      setLayoutTunerOpen(false);
    });
    layoutResetElement?.addEventListener('click', () => {
      resetLayoutTunerValues();
    });
    layoutSaveElement?.addEventListener('click', () => {
      saveLayoutTunerValues();
    });

    layoutOffsetXElement?.addEventListener('input', () => {
      const displayValues = toLayoutDisplayValues(layoutTunerState?.values || getCurrentLayoutTunerValues());
      applyLayoutTunerValues(fromLayoutDisplayValues({
        ...displayValues,
        offsetX: roundToStep(layoutOffsetXElement.value, 1)
      }));
    });
    layoutOffsetYElement?.addEventListener('input', () => {
      const displayValues = toLayoutDisplayValues(layoutTunerState?.values || getCurrentLayoutTunerValues());
      applyLayoutTunerValues(fromLayoutDisplayValues({
        ...displayValues,
        offsetY: roundToStep(layoutOffsetYElement.value, 1)
      }));
    });
    layoutScaleElement?.addEventListener('input', () => {
      applyLayoutTunerValues({
        ...(layoutTunerState?.values || getCurrentLayoutTunerValues()),
        scaleMultiplier: roundToStep(layoutScaleElement.value, 0.01)
      });
    });
  }

  function applyMouthTunerValues(nextValues = {}, { immediate = false, statusMessage = '' } = {}) {
    mouthTunerState.values = normalizeMouthTunerValues({
      ...(mouthTunerState?.values || {}),
      ...nextValues
    });
    syncMouthTunerControls();
    if (statusMessage) {
      setMouthTunerStatus(statusMessage);
    }
    if (immediate && mouthTunerState.enabled) {
      applyDebugMouthTunerForCurrentFrame();
    }
  }

  function setMouthTunerEnabled(enabled, { immediate = false, statusMessage = '' } = {}) {
    mouthTunerState.enabled = Boolean(enabled);
    syncMouthTunerControls();
    if (mouthTunerState.enabled) {
      setMouthTunerStatus(statusMessage || 'Override active');
      if (immediate) {
        applyDebugMouthTunerForCurrentFrame();
      }
      return;
    }
    setMouthTunerStatus(statusMessage || 'Override disabled');
  }

  function setExternalMouthOverride(params = {}) {
    const enabled = params?.enabled === true;
    externalMouthOverrideState = {
      enabled,
      values: normalizeMouthTunerValues({
        ...(externalMouthOverrideState?.values || {}),
        ...params
      })
    };

    if (enabled) {
      applyExternalMouthOverrideForCurrentFrame();
    }

    return {
      ok: true,
      enabled,
      values: externalMouthOverrideState.values
    };
  }

  function initMouthTuner() {
    const mouthTunerConfig = getMouthTunerRuntimeConfig();
    mouthTunerState = {
      open: false,
      enabled: mouthTunerConfig.enabled,
      values: normalizeMouthTunerValues({
        mouthOpen: 0,
        mouthForm: 0
      })
    };
    syncMouthTunerControls();
    setMouthTunerOpen(false);
    setMouthTunerVisible(mouthTunerConfig.visible);
    setMouthTunerStatus(mouthTunerConfig.enabled ? 'Override active' : 'Override disabled');

    if (!mouthTunerConfig.visible) {
      return;
    }

    mouthTunerToggleElement?.addEventListener('click', () => {
      setMouthTunerOpen(!mouthTunerState?.open);
    });
    mouthTunerCloseElement?.addEventListener('click', () => {
      setMouthTunerOpen(false);
    });
    mouthTunerEnableElement?.addEventListener('change', () => {
      setMouthTunerEnabled(mouthTunerEnableElement.checked, {
        immediate: true
      });
    });
    mouthOpenElement?.addEventListener('input', () => {
      applyMouthTunerValues({
        mouthOpen: roundToStep(mouthOpenElement.value, 0.01)
      }, {
        immediate: true
      });
    });
    mouthFormElement?.addEventListener('input', () => {
      applyMouthTunerValues({
        mouthForm: roundToStep(mouthFormElement.value, 0.01)
      }, {
        immediate: true
      });
    });
    mouthNeutralElement?.addEventListener('click', () => {
      applyMouthTunerValues({
        mouthOpen: 0,
        mouthForm: 0
      }, {
        immediate: true,
        statusMessage: 'Neutral mouth'
      });
    });
    mouthApplyIElement?.addEventListener('click', () => {
      applyMouthTunerValues({
        mouthOpen: 0.25,
        mouthForm: 1
      }, {
        immediate: true,
        statusMessage: 'Applied long I debug pose'
      });
      setMouthTunerEnabled(true, {
        immediate: true,
        statusMessage: 'Override active'
      });
    });
  }

  function initChatPanel(config) {
    if (!chatStateApi) {
      throw new Error('ChatPanelState runtime is unavailable');
    }

    const panelConfig = config?.panel || {};
    chatPanelEnabled = Boolean(panelConfig.enabled);

    chatPanelState = chatStateApi.createInitialState({
      defaultVisible: panelConfig.defaultVisible,
      maxMessages: panelConfig.maxMessages,
      inputEnabled: panelConfig.inputEnabled
    });

    if (chatPanelElement) {
      const width = Number(panelConfig.width);
      const height = Number(panelConfig.height);
      if (Number.isFinite(width) && width > 0) {
        chatPanelElement.style.width = `${width}px`;
      }
      if (Number.isFinite(height) && height > 0) {
        chatPanelElement.style.height = `${height}px`;
      }
    }

    resizeModeCloseElement?.addEventListener('click', () => {
      bridge?.sendWindowControl?.({ action: 'close_resize_mode' });
    });

    if (!chatPanelEnabled) {
      chatPanelElement?.remove();
      syncChatStateSummary();
      return;
    }

    if (chatComposerElement) {
      chatComposerElement.style.display = chatPanelState.inputEnabled ? 'flex' : 'none';
    }

    if (chatInputElement) {
      chatInputElement.disabled = !chatPanelState.inputEnabled;
    }
    if (chatSendElement) {
      chatSendElement.disabled = !chatPanelState.inputEnabled;
    }
    petHideElement?.addEventListener('click', () => {
      bridge?.sendWindowControl?.({ action: 'hide' });
    });
    petCloseElement?.addEventListener('click', () => {
      bridge?.sendWindowControl?.({ action: 'close_pet' });
    });

    renderChatMessages();
    applyChatPanelVisibility();

    const submitInput = () => {
      if (!chatPanelState?.inputEnabled) {
        return;
      }
      const text = String(chatInputElement?.value || '').trim();
      if (!text) {
        return;
      }

      const payload = {
        role: 'user',
        text,
        timestamp: Date.now(),
        source: 'chat-panel'
      };

      appendChatMessage(payload, 'user');
      if (chatInputElement) {
        chatInputElement.value = '';
      }
      bridge?.sendChatInput?.(payload);
    };

    chatSendElement?.addEventListener('click', submitInput);
    chatInputElement?.addEventListener('compositionstart', () => {
      chatInputComposing = true;
    });
    chatInputElement?.addEventListener('compositionend', () => {
      chatInputComposing = false;
    });
    chatInputElement?.addEventListener('blur', () => {
      chatInputComposing = false;
    });
    chatInputElement?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      const composing = typeof interactionApi?.isImeComposingEvent === 'function'
        ? interactionApi.isImeComposingEvent(event, chatInputComposing)
        : Boolean(event?.isComposing || Number(event?.keyCode) === 229 || chatInputComposing);
      if (composing) {
        return;
      }
      event.preventDefault();
      submitInput();
    });
  }

  async function initPixi() {
    const PIXI = window.PIXI;
    if (!PIXI) {
      throw new Error('PIXI global is not available');
    }

    const renderConfig = runtimeUiConfig?.render || {};
    const resolutionScale = Number(renderConfig.resolutionScale) || 1;
    const maxDevicePixelRatio = Number(renderConfig.maxDevicePixelRatio) || 2;
    const antialias = Boolean(renderConfig.antialias);
    const resolution = Math.max(1, Math.min(maxDevicePixelRatio, (Number(window.devicePixelRatio) || 1) * resolutionScale));
    const rendererOptions = {
      transparent: true,
      resizeTo: window,
      antialias,
      autoDensity: true,
      resolution,
      powerPreference: 'high-performance'
    };

    const supportsAsyncInit = typeof PIXI.Application?.prototype?.init === 'function';
    const app = supportsAsyncInit
      ? new PIXI.Application()
      : new PIXI.Application(rendererOptions);

    if (typeof app.init === 'function') {
      await app.init({
        ...rendererOptions,
        backgroundAlpha: 0
      });
    }

    const canvas = app.canvas || app.view;
    if (!canvas) {
      throw new Error('PIXI canvas/view is unavailable');
    }

    stageContainer.appendChild(canvas);
    pixiApp = app;
    bindWindowDragGesture(canvas);
  }

  function resolveLive2dConstructor() {
    return window.PIXI?.live2d?.Live2DModel
      || window.Live2DModel
      || window.PIXI?.Live2DModel
      || null;
  }

  async function loadModel(modelRelativePath, modelName) {
    const Live2DModel = resolveLive2dConstructor();
    if (!Live2DModel || typeof Live2DModel.from !== 'function') {
      throw new Error('Live2DModel runtime is unavailable');
    }

    const modelUrl = new URL(modelRelativePath, window.location.href).toString();
    live2dModel = await Live2DModel.from(modelUrl);
    stableModelScale = null;
    stableModelPose = null;
    modelBaseBounds = null;
    bindModelInteraction();

    pixiApp.stage.addChild(live2dModel);
    if (!bindLipSyncModelHook()) {
      bindLipSyncTicker();
    }
    const initialBounds = live2dModel.getLocalBounds?.();
    if (
      initialBounds
      && Number.isFinite(initialBounds.x)
      && Number.isFinite(initialBounds.y)
      && Number.isFinite(initialBounds.width)
      && Number.isFinite(initialBounds.height)
      && initialBounds.width > 0
      && initialBounds.height > 0
    ) {
      modelBaseBounds = {
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width,
        height: initialBounds.height
      };
    }
    applyAdaptiveLayout();
    window.addEventListener('resize', scheduleAdaptiveLayout, { passive: true });

    state.modelLoaded = true;
    state.modelName = modelName || null;
  }

  function bindModelInteraction() {
    if (!live2dModel || typeof live2dModel.on !== 'function') {
      return;
    }

    if ('eventMode' in live2dModel) {
      live2dModel.eventMode = 'static';
    }
    if ('interactive' in live2dModel) {
      live2dModel.interactive = true;
    }
    live2dModel.on('pointertap', () => {
      if (state.resizeModeEnabled) {
        return;
      }
      const now = Date.now();
      if (now < suppressModelTapUntil) {
        return;
      }
      if (typeof modelTapToggleGate?.tryEnter === 'function' && !modelTapToggleGate.tryEnter()) {
        return;
      }
      if (!chatPanelEnabled) {
        bridge?.sendChatPanelToggle?.({ source: 'avatar-window' });
        return;
      }
      toggleChatPanelVisible();
    });
  }

  function bindWindowDragGesture(targetElement) {
    if (!targetElement || typeof bridge?.sendWindowDrag !== 'function') {
      return;
    }

    const moveThresholdPx = 6;
    const resetDragState = () => {
      dragPointerState = null;
    };

    targetElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragPointerState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startWindowWidth: Number(state.windowState?.width) || window.innerWidth || 460,
        dragging: false
      };
      if (typeof targetElement.setPointerCapture === 'function') {
        targetElement.setPointerCapture(event.pointerId);
      }
      if (state.resizeModeEnabled) {
        event.preventDefault();
        return;
      }
      bridge.sendWindowDrag({
        action: 'start',
        screenX: event.screenX,
        screenY: event.screenY
      });
    });

    targetElement.addEventListener('pointermove', (event) => {
      if (!dragPointerState || event.pointerId !== dragPointerState.pointerId) {
        return;
      }
      const deltaX = event.clientX - dragPointerState.startClientX;
      const deltaY = event.clientY - dragPointerState.startClientY;
      const moved = Math.hypot(deltaX, deltaY);
      if (!dragPointerState.dragging && moved >= moveThresholdPx) {
        dragPointerState.dragging = true;
      }
      if (!dragPointerState.dragging) {
        return;
      }
      if (state.resizeModeEnabled) {
        const deltaWidth = dragPointerState.startScreenX - event.screenX;
        requestResizeModeWindowFit({
          requestedWidth: dragPointerState.startWindowWidth + deltaWidth,
          persist: false
        });
      } else {
        bridge.sendWindowDrag({
          action: 'move',
          screenX: event.screenX,
          screenY: event.screenY
        });
      }
      event.preventDefault();
    });

    const completeDrag = (event) => {
      if (!dragPointerState || event.pointerId !== dragPointerState.pointerId) {
        return;
      }
      if (!state.resizeModeEnabled) {
        bridge.sendWindowDrag({
          action: 'end',
          screenX: event.screenX,
          screenY: event.screenY
        });
      } else if (dragPointerState.dragging) {
        requestResizeModeWindowFit({
          requestedWidth: lastResizeModeRequest?.width || Number(state.windowState?.width) || dragPointerState.startWindowWidth,
          persist: true
        });
      }
      if (dragPointerState.dragging) {
        suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_DRAG_MS);
      }
      if (typeof targetElement.releasePointerCapture === 'function') {
        try {
          targetElement.releasePointerCapture(event.pointerId);
        } catch {
          // ignore pointer capture release errors on fast close/cancel
        }
      }
      resetDragState();
    };

    targetElement.addEventListener('pointerup', completeDrag);
    targetElement.addEventListener('pointercancel', completeDrag);
  }

  function getStageSize() {
    const rendererWidth = pixiApp?.renderer?.screen?.width;
    const rendererHeight = pixiApp?.renderer?.screen?.height;
    return {
      width: rendererWidth || window.innerWidth || 640,
      height: rendererHeight || window.innerHeight || 720
    };
  }

  function getResizeModeBaseWindowSize() {
    const baseWidth = Math.max(1, Number(state.windowState?.defaultWidth) || Number(state.windowState?.width) || window.innerWidth || 460);
    const baseHeight = Math.max(1, Number(state.windowState?.defaultHeight) || Number(state.windowState?.height) || window.innerHeight || 620);
    return {
      baseWidth,
      baseHeight,
      aspectRatio: Number(state.windowState?.aspectRatio) || (baseWidth / baseHeight)
    };
  }

  function getResizeModeWindowScaleFactor() {
    const { baseWidth, baseHeight } = getResizeModeBaseWindowSize();
    const currentWidth = Math.max(1, Number(state.windowState?.width) || window.innerWidth || baseWidth);
    const currentHeight = Math.max(1, Number(state.windowState?.height) || window.innerHeight || baseHeight);
    return Math.max(currentWidth / baseWidth, currentHeight / baseHeight);
  }

  function computeResizeModeReferenceLayout(bounds, layoutConfig) {
    if (!window.Live2DLayout?.computeModelLayout) {
      return null;
    }
    const { baseWidth, baseHeight } = getResizeModeBaseWindowSize();
    return window.Live2DLayout.computeModelLayout({
      stageWidth: baseWidth,
      stageHeight: baseHeight,
      boundsX: bounds.x,
      boundsY: bounds.y,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      ...layoutConfig
    });
  }

  function clampResizeModeWindowWidth(requestedWidth) {
    const { baseWidth, baseHeight, aspectRatio } = getResizeModeBaseWindowSize();
    const minWidth = Number(state.windowState?.minWidth) || 180;
    const minHeight = Number(state.windowState?.minHeight) || 260;
    const maxWidth = Number(state.windowState?.maxWidth) || 900;
    const maxHeight = Number(state.windowState?.maxHeight) || 1400;
    const safeAspectRatio = Number(aspectRatio) || (baseWidth / baseHeight);
    const minAllowedWidth = Math.max(minWidth, Math.ceil(minHeight * safeAspectRatio));
    const maxAllowedWidth = Math.min(maxWidth, Math.floor(maxHeight * safeAspectRatio));
    return clamp(Number(requestedWidth) || baseWidth, minAllowedWidth, maxAllowedWidth);
  }

  function computeResizeModeWindowSize({ requestedWidth }) {
    const { baseWidth, baseHeight, aspectRatio } = getResizeModeBaseWindowSize();
    const safeAspectRatio = Number(aspectRatio) || (baseWidth / baseHeight);
    const safeWidth = clampResizeModeWindowWidth(requestedWidth);
    return {
      width: Math.max(1, Math.round(safeWidth)),
      height: Math.max(1, Math.round(safeWidth / safeAspectRatio))
    };
  }

  function requestResizeModeWindowFit({ requestedWidth, persist = false }) {
    const nextSize = computeResizeModeWindowSize({ requestedWidth });
    const last = lastResizeModeRequest;
    const changed = !last
      || Math.abs(last.width - nextSize.width) >= 2
      || Math.abs(last.height - nextSize.height) >= 2
      || persist;
    if (!changed) {
      return;
    }
    lastResizeModeRequest = nextSize;
    requestWindowResize({
      action: 'set',
      source: 'resize-drag',
      width: nextSize.width,
      height: nextSize.height,
      persist
    });
  }

  function applyAdaptiveLayout() {
    if (!live2dModel || !window.Live2DLayout?.computeModelLayout) return;
    const bounds = modelBaseBounds || live2dModel.getLocalBounds?.();
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
      return;
    }

    const stageSize = getStageSize();
    const layoutConfig = runtimeUiConfig?.layout || {};
    const lockScaleOnResize = layoutConfig.lockScaleOnResize !== false;
    const lockPositionOnResize = layoutConfig.lockPositionOnResize !== false;
    const layout = window.Live2DLayout.computeModelLayout({
      stageWidth: stageSize.width,
      stageHeight: stageSize.height,
      boundsX: bounds.x,
      boundsY: bounds.y,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      ...layoutConfig
    });
    const resizeModeReferenceLayout = state.resizeModeEnabled
      ? (computeResizeModeReferenceLayout(bounds, layoutConfig) || layout)
      : null;

    if (stableModelScale === null || !Number.isFinite(stableModelScale)) {
      stableModelScale = layout.scale;
    }
    if (!state.resizeModeEnabled) {
      resizeModeScaleFactor = 1;
      lastResizeModeRequest = null;
      stableModelScale = layout.scale;
    }

    const shouldFollowWindowScale = !lockScaleOnResize;
    const nextScale = state.resizeModeEnabled
      ? resizeModeReferenceLayout.scale * getResizeModeWindowScaleFactor()
      : (shouldFollowWindowScale ? layout.scale : Math.min(stableModelScale, layout.scale));
    if (!state.resizeModeEnabled && shouldFollowWindowScale) {
      stableModelScale = layout.scale;
    }

    if (
      !stableModelPose
      || !Number.isFinite(stableModelPose.positionX)
      || !Number.isFinite(stableModelPose.positionY)
      || !Number.isFinite(stableModelPose.stageWidth)
      || !Number.isFinite(stableModelPose.stageHeight)
    ) {
      stableModelPose = {
        positionX: layout.positionX,
        positionY: layout.positionY,
        stageWidth: stageSize.width,
        stageHeight: stageSize.height
      };
    }

    let nextPositionX = state.resizeModeEnabled
      ? resizeModeReferenceLayout.positionX * getResizeModeWindowScaleFactor()
      : layout.positionX;
    let nextPositionY = state.resizeModeEnabled
      ? resizeModeReferenceLayout.positionY * getResizeModeWindowScaleFactor()
      : layout.positionY;
    if (!state.resizeModeEnabled && lockPositionOnResize) {
      const deltaWidth = stageSize.width - stableModelPose.stageWidth;
      const deltaHeight = stageSize.height - stableModelPose.stageHeight;
      nextPositionX = stableModelPose.positionX + deltaWidth;
      nextPositionY = stableModelPose.positionY + deltaHeight;
      stableModelPose = {
        positionX: nextPositionX,
        positionY: nextPositionY,
        stageWidth: stageSize.width,
        stageHeight: stageSize.height
      };
    } else {
      stableModelPose = {
        positionX: layout.positionX,
        positionY: layout.positionY,
        stageWidth: stageSize.width,
        stageHeight: stageSize.height
      };
    }

    const clampedPose = typeof window.Live2DLayout?.clampModelPositionToViewport === 'function'
      ? window.Live2DLayout.clampModelPositionToViewport({
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        positionX: nextPositionX,
        positionY: nextPositionY,
        scale: nextScale,
        boundsX: bounds.x,
        boundsY: bounds.y,
        boundsWidth: bounds.width,
        boundsHeight: bounds.height,
        pivotX: state.resizeModeEnabled ? resizeModeReferenceLayout.pivotX : layout.pivotX,
        pivotY: state.resizeModeEnabled ? resizeModeReferenceLayout.pivotY : layout.pivotY,
        visibleMarginLeft: Number(layoutConfig.visibleMarginLeft),
        visibleMarginRight: Number(layoutConfig.visibleMarginRight),
        visibleMarginTop: Number(layoutConfig.visibleMarginTop),
        visibleMarginBottom: Number(layoutConfig.visibleMarginBottom)
      })
      : null;
    if (clampedPose) {
      nextPositionX = clampedPose.positionX;
      nextPositionY = clampedPose.positionY;
      stableModelPose = {
        positionX: nextPositionX,
        positionY: nextPositionY,
        stageWidth: stageSize.width,
        stageHeight: stageSize.height
      };
    }

    if (
      typeof live2dModel.scale?.set === 'function'
      && shouldUpdate2DTransform(live2dModel.scale?.x, live2dModel.scale?.y, nextScale, nextScale, 1e-5)
    ) {
      live2dModel.scale.set(nextScale);
    }
    if (
      typeof live2dModel.pivot?.set === 'function'
      && shouldUpdate2DTransform(
        live2dModel.pivot?.x,
        live2dModel.pivot?.y,
        state.resizeModeEnabled ? resizeModeReferenceLayout.pivotX : layout.pivotX,
        state.resizeModeEnabled ? resizeModeReferenceLayout.pivotY : layout.pivotY,
        1e-5
      )
    ) {
      live2dModel.pivot.set(
        state.resizeModeEnabled ? resizeModeReferenceLayout.pivotX : layout.pivotX,
        state.resizeModeEnabled ? resizeModeReferenceLayout.pivotY : layout.pivotY
      );
    }
    if (
      typeof live2dModel.position?.set === 'function'
      && shouldUpdate2DTransform(live2dModel.position?.x, live2dModel.position?.y, nextPositionX, nextPositionY, 1e-5)
    ) {
      live2dModel.position.set(nextPositionX, nextPositionY);
    }

    state.layout = {
      scale: nextScale,
      positionX: nextPositionX,
      positionY: nextPositionY,
      pivotX: state.resizeModeEnabled ? resizeModeReferenceLayout.pivotX : layout.pivotX,
      pivotY: state.resizeModeEnabled ? resizeModeReferenceLayout.pivotY : layout.pivotY,
      ...layout.debug
    };

    if (state.bubbleVisible) {
      positionBubbleNearModelHead();
    }

    const worldBounds = live2dModel.getBounds?.();
    if (
      worldBounds
      && Number.isFinite(worldBounds.x)
      && Number.isFinite(worldBounds.y)
      && Number.isFinite(worldBounds.width)
      && Number.isFinite(worldBounds.height)
      && worldBounds.width > 4
      && worldBounds.height > 4
      && !state.resizeModeEnabled
      && typeof bridge?.sendModelBounds === 'function'
    ) {
      const payload = {
        x: Math.round(worldBounds.x),
        y: Math.round(worldBounds.y),
        width: Math.round(worldBounds.width),
        height: Math.round(worldBounds.height),
        stageWidth: Math.round(stageSize.width),
        stageHeight: Math.round(stageSize.height)
      };
      const prev = lastReportedModelBounds;
      const changed = !prev
        || Math.abs(prev.x - payload.x) >= 2
        || Math.abs(prev.y - payload.y) >= 2
        || Math.abs(prev.width - payload.width) >= 2
        || Math.abs(prev.height - payload.height) >= 2;
      if (changed) {
        lastReportedModelBounds = payload;
        bridge.sendModelBounds(payload);
      }
    }
  }

  function scheduleAdaptiveLayout() {
    if (layoutRafToken) {
      return;
    }
    layoutRafToken = window.requestAnimationFrame(() => {
      layoutRafToken = 0;
      applyAdaptiveLayout();
    });
  }

  async function handleInvoke(payload) {
    console.log('[Renderer] Received RPC invoke:', payload);
    const { requestId, method, params } = payload || {};

    try {
      let result;
      if (method === 'state.get') {
        result = getState();
      } else if (method === 'debug.mouthOverride.set') {
        result = setExternalMouthOverride(params);
      } else if (method === 'param.set' || method === 'model.param.set') {
        result = setModelParam(params);
      } else if (method === 'model.param.batchSet') {
        result = setModelParamsBatch(params);
      } else if (method === 'model.motion.play') {
        result = await playModelMotion(params);
      } else if (method === 'model.expression.set') {
        result = await setModelExpression(params);
      } else if (method === 'chat.show' || method === 'chat.bubble.show') {
        result = showBubble(params);
      } else if (method === 'chat.panel.show') {
        result = setChatPanelVisible(true);
      } else if (method === 'chat.panel.hide') {
        result = setChatPanelVisible(false);
      } else if (method === 'chat.panel.append') {
        result = appendChatMessage(params, 'assistant');
      } else if (method === 'chat.panel.clear') {
        result = clearChatMessages();
      } else if (method === 'live2d.action.enqueue') {
        if (!actionMessageApi || typeof actionMessageApi.normalizeLive2dActionMessage !== 'function') {
          throw createRpcError(-32005, 'Live2DActionMessage runtime is unavailable');
        }
        const normalized = actionMessageApi.normalizeLive2dActionMessage(params);
        if (!normalized.ok) {
          throw createRpcError(-32602, normalized.error);
        }
        const player = ensureActionQueuePlayer();
        result = player.enqueue(normalized.value);
      } else if (method === 'server_event_forward') {
        const { name, data } = params || {};
        console.log('[Renderer] Received RPC invoke:', name);
        if (name === 'voice.play') {
          result = await handleVoicePlaybackRequest(data || {});
        } else if (name === 'voice.playback.electron') {
          result = await handleVoicePlaybackRequest(data || {});
        } else {
          result = { ok: true, ignored: true };
        }
      } else {
        throw createRpcError(-32601, `method not found: ${method}`);
      }

      bridge.sendResult({ requestId, result });
    } catch (err) {
      const error = err && typeof err.code === 'number'
        ? err
        : createRpcError(-32005, err?.message || String(err || 'unknown error'));

      bridge.sendResult({ requestId, error });
    }
  }

  async function main() {
    try {
      if (!bridge) {
        throw new Error('desktopLive2dBridge is unavailable');
      }

      window.addEventListener('focus', () => {
        suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS);
      }, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS);
        }
      });

      const runtimeConfig = await bridge.getRuntimeConfig();
      runtimeUiConfig = runtimeConfig.uiConfig || null;
      runtimeLive2dPresets = runtimeConfig.live2dPresets || null;
      initLayoutTuner();
      initMouthTuner();
      detachWindowStateSync = bridge.onWindowStateSync?.((payload) => {
        applyWindowState(payload);
      }) || null;
      initChatPanel(runtimeUiConfig?.chat || {});
      await initPixi();
      await loadModel(runtimeConfig.modelRelativePath, runtimeConfig.modelName);
      ensureActionQueuePlayer();

      bridge.onInvoke((payload) => {
        void handleInvoke(payload);
      });
      bridge.onVoicePlay?.((payload) => {
        void handleVoicePlaybackRequest(payload).catch((err) => {
          console.error('[Renderer] desktop:voice:play failed', err);
        });
      });
      bridge.onVoicePlayMemory?.((payload) => {
        void handleVoicePlaybackMemoryRequest(payload).catch((err) => {
          console.error('[Renderer] desktop:voice:play-memory failed', err);
        });
      });

      bridge.notifyReady({ ok: true });
    } catch (err) {
      state.lastError = err?.message || String(err || 'renderer bootstrap failed');
      bridge?.notifyError({ message: state.lastError });
    }
  }

  window.addEventListener('beforeunload', () => {
    if (typeof detachWindowStateSync === 'function') {
      detachWindowStateSync();
    }
    stopLipSync();
    if (typeof detachLipSyncModelHook === 'function') {
      detachLipSyncModelHook();
    }
    if (typeof detachLipSyncTicker === 'function') {
      detachLipSyncTicker();
    }
    if (lipsyncCtx && lipsyncCtx.state !== 'closed') {
      void lipsyncCtx.close().catch(() => { });
    }
  });

  window.Live2DDesktopWindow = {
    getWindowState: () => state.windowState,
    requestResize: requestWindowResize
  };

  void main();
})();
