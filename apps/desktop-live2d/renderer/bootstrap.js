(function bootstrap() {
  const bridge = window.desktopLive2dBridge;
  const interactionApi = window.Live2DInteraction || null;
  const actionMessageApi = window.Live2DActionMessage || null;
  const actionMutexApi = window.Live2DActionMutex || null;
  const actionQueueApi = window.Live2DActionQueuePlayer || null;
  const actionExecutorApi = window.Live2DActionExecutor || null;
  const lipsyncApi = window.Live2DVisemeLipSync || null;
  const mouthTransitionApi = window.Live2DMouthTransition || null;
  const state = {
    modelLoaded: false,
    modelName: null,
    bubbleVisible: false,
    chatPanelVisible: false,
    chatHistorySize: 0,
    lastError: null,
    layout: null,
    windowState: null,
    resizeModeEnabled: false,
    presenterMode: 'live2d',
    musicPlayback: null
  };

  let pixiApp = null;
  let live2dModel = null;
  let hideBubbleTimer = null;
  const systemAudio = new Audio();
  systemAudio.autoplay = true;
  let currentVoiceObjectUrl = null;
  let dragPointerState = null;
  let suppressModelTapUntil = 0;
  let stableModelScale = null;
  let stableModelPose = null;
  let resizeModeScaleFactor = 1;
  let resizeModeBaseWindowSize = null;
  let lastResizeModeRequest = null;
  let modelBaseBounds = null;
  let actionQueuePlayer = null;
  let actionExecutionMutex = null;
  let actionExecutor = null;
  let audioContext = null;
  let lipsyncState = null;
  let lipsyncAnimationFrame = null;
  let lipsyncReleaseAnimationFrame = null;
  let lipsyncAudioSource = null;
  let lipsyncAnalyser = null;
  let lipsyncTargetMouthOpen = 0;
  let lipsyncTargetMouthForm = 0;
  let lipsyncCurrentMouthOpen = 0;
  let lipsyncCurrentMouthForm = 0;
  let lipsyncBaselineMouthOpen = 0;
  let lipsyncBaselineMouthForm = 0;
  let lipsyncOpenDeadzoneActive = false;
  let lipsyncSpeakingActive = false;
  let lipsyncDetachModelHook = null;
  let lipsyncDetachTickerHook = null;
  let mouthOverrideDetachModelHook = null;
  let mouthOverrideDetachTickerHook = null;
  let lipsyncApplyMode = 'raf_direct';
  let activeVoiceRequestId = null;
  let systemAudioDebugBound = false;
  let realtimeVoicePlayer = null;
  let lipsyncMediaElementSource = null;
  let lipsyncMediaElement = null;
  let lipsyncMediaElementAnalyser = null;
  let faceBlendState = {
    current: {
      mouthForm: 0,
      eyeSmileL: 0,
      eyeSmileR: 0,
      cheek: 0
    },
    target: {
      mouthForm: 0,
      eyeSmileL: 0,
      eyeSmileR: 0,
      cheek: 0
    }
  };
  let layoutTunerState = null;
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
  let lastWindowInteractivity = null;
  let lastPointerPosition = null;
  let audioFrameBus = null;
  let waveformPresenter = null;
  let waveformLayer = null;
  let waveformBackdropGraphic = null;
  let waveformGlowGraphic = null;
  let waveformFillGraphic = null;
  let waveformStrokeGraphic = null;
  let waveformCenterGraphic = null;
  let waveformTickerHookBound = false;
  let rendererMusicPlayer = null;
  let rendererMusicEventsBound = false;
  let activePresenterAction = null;
  let queuedPresenterActions = new Map();

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
  const resizeModeCloseElement = document.getElementById('resize-mode-close');
  const layoutTunerToggleElement = document.getElementById('layout-tuner-toggle');
  const dragZoneToggleElement = document.getElementById('drag-zone-toggle');
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
  const dragZoneVisualElement = document.getElementById('drag-zone-visual');
  const dragZoneCloseElement = document.getElementById('drag-zone-close');
  const dragZoneCenterXElement = document.getElementById('drag-zone-center-x');
  const dragZoneCenterYElement = document.getElementById('drag-zone-center-y');
  const dragZoneWidthElement = document.getElementById('drag-zone-width');
  const dragZoneHeightElement = document.getElementById('drag-zone-height');
  const dragZoneCenterXValueElement = document.getElementById('drag-zone-center-x-value');
  const dragZoneCenterYValueElement = document.getElementById('drag-zone-center-y-value');
  const dragZoneWidthValueElement = document.getElementById('drag-zone-width-value');
  const dragZoneHeightValueElement = document.getElementById('drag-zone-height-value');
  const dragZoneResetElement = document.getElementById('drag-zone-reset');
  const dragZoneSaveElement = document.getElementById('drag-zone-save');
  const dragZoneStatusElement = document.getElementById('drag-zone-status');

  const chatStateApi = window.ChatPanelState;
  let runtimeUiConfig = null;
  let runtimeLive2dPresets = null;
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
  const layoutTunerDefaults = window.DesktopLive2dDefaults?.DEFAULT_LAYOUT_CONFIG || {
    offsetX: 0,
    offsetY: 0,
    scaleMultiplier: 1
  };
  const dragZoneDefaults = window.DesktopLive2dDefaults?.DEFAULT_DRAG_ZONE_CONFIG || {
    centerXRatio: 0.5,
    centerYRatio: 0.5,
    widthRatio: 1 / 3,
    heightRatio: 1 / 3
  };
  let dragZoneTunerState = null;
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
  const LIPSYNC_ACTIVE_ENERGY_MIN = 0.018;
  const LIPSYNC_BASELINE_OPEN_ALPHA = 0.032;
  const LIPSYNC_BASELINE_FORM_ALPHA = 0.02;
  const LIPSYNC_VARIANCE_OPEN_GAIN_MIN = 3.0;
  const LIPSYNC_VARIANCE_OPEN_GAIN_MAX = 4.0;
  const LIPSYNC_VARIANCE_OPEN_NEGATIVE_GAIN = 0.9;
  const LIPSYNC_SPEAKING_OPEN_FLOOR_RATIO = 0.22;
  const LIPSYNC_OPEN_DEADZONE_ENTER = 0.09;
  const LIPSYNC_OPEN_DEADZONE_EXIT = 0.11;
  const LIPSYNC_VARIANCE_FORM_GAIN_MIN = 2.0;
  const LIPSYNC_VARIANCE_FORM_GAIN_MAX = 3.0;
  const FACE_BLEND_ATTACK = 0.2;
  const FACE_BLEND_RELEASE = 0.12;
  const FACE_BLEND_SPEECH_MOUTHFORM_WEIGHT = 0.18;
  const DEFAULT_MOUTH_BASE_POSE = Object.freeze({
    mouthOpen: 0,
    mouthForm: 0
  });
  const FACE_BLEND_DEFAULTS = Object.freeze({
    mouthForm: 0,
    eyeSmileL: 0,
    eyeSmileR: 0,
    cheek: 0
  });

  function normalizePresenterModeValue(mode, fallback = 'live2d') {
    const normalizer = window.RendererAudioFrameBus?.normalizeMode
      || window.RendererWaveformPresenter?.normalizeMode;
    if (typeof normalizer === 'function') {
      return normalizer(mode, fallback);
    }
    const normalized = String(mode || fallback).trim().toLowerCase();
    return ['live2d', 'waveform', 'hybrid'].includes(normalized) ? normalized : fallback;
  }

  function getConfiguredPresenterMode() {
    const configured = runtimeUiConfig?.presenter?.mode;
    return normalizePresenterModeValue(configured, state.presenterMode || 'live2d');
  }

  function ensureAudioFrameBus() {
    if (audioFrameBus) {
      return audioFrameBus;
    }
    const factory = window.RendererAudioFrameBus?.createRendererAudioFrameBus;
    if (typeof factory !== 'function') {
      return null;
    }
    audioFrameBus = factory({
      mode: getConfiguredPresenterMode()
    });
    return audioFrameBus;
  }

  function drawPolyline(graphics, points) {
    if (!graphics || !Array.isArray(points) || points.length === 0) {
      return;
    }
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
  }

  function drawWaveformEnvelope(graphics, geometry) {
    if (!graphics || !geometry) {
      return;
    }
    const topPoints = Array.isArray(geometry.topPoints) ? geometry.topPoints : [];
    const bottomPoints = Array.isArray(geometry.bottomPoints) ? geometry.bottomPoints : [];
    if (topPoints.length === 0 || bottomPoints.length === 0) {
      return;
    }
    drawPolyline(graphics, topPoints);
    for (let index = bottomPoints.length - 1; index >= 0; index -= 1) {
      graphics.lineTo(bottomPoints[index].x, bottomPoints[index].y);
    }
    graphics.closePath();
  }

  function ensureWaveformLayer() {
    if (waveformLayer) {
      return waveformLayer;
    }
    const PIXI = window.PIXI;
    if (!PIXI?.Container || !PIXI?.Graphics || !pixiApp?.stage) {
      return null;
    }

    waveformLayer = new PIXI.Container();
    waveformLayer.visible = false;
    waveformBackdropGraphic = new PIXI.Graphics();
    waveformGlowGraphic = new PIXI.Graphics();
    waveformFillGraphic = new PIXI.Graphics();
    waveformStrokeGraphic = new PIXI.Graphics();
    waveformCenterGraphic = new PIXI.Graphics();
    if (PIXI.BLEND_MODES) {
      waveformGlowGraphic.blendMode = PIXI.BLEND_MODES.ADD;
    }
    waveformLayer.addChild(
      waveformBackdropGraphic,
      waveformGlowGraphic,
      waveformFillGraphic,
      waveformStrokeGraphic,
      waveformCenterGraphic
    );
    pixiApp.stage.addChild(waveformLayer);
    return waveformLayer;
  }

  function ensureWaveformPresenter() {
    if (waveformPresenter) {
      return waveformPresenter;
    }
    const factory = window.RendererWaveformPresenter?.createWaveformPresenter;
    if (typeof factory !== 'function') {
      return null;
    }
    waveformPresenter = factory({
      mode: getConfiguredPresenterMode()
    });
    return waveformPresenter;
  }

  function syncMusicPlaybackState(overrides = {}) {
    const audioElement = rendererMusicPlayer?.audioElement || null;
    const prev = state.musicPlayback && typeof state.musicPlayback === 'object'
      ? state.musicPlayback
      : {};
    const nextStatus = overrides.status
      || (audioElement
        ? (
            rendererMusicPlayer?.currentSrc
              ? (audioElement.ended ? 'ended' : (audioElement.paused ? 'paused' : 'playing'))
              : 'stopped'
          )
        : (prev.status || 'idle'));
    state.musicPlayback = {
      status: nextStatus,
      path: overrides.path !== undefined ? overrides.path : (prev.path || null),
      audioUrl: overrides.audioUrl !== undefined ? overrides.audioUrl : (prev.audioUrl || null),
      volume: overrides.volume !== undefined
        ? clamp(Number(overrides.volume) || 0, 0, 1)
        : clamp(Number(audioElement?.volume ?? prev.volume ?? 1) || 0, 0, 1),
      loop: overrides.loop !== undefined ? Boolean(overrides.loop) : Boolean(audioElement?.loop ?? prev.loop),
      trackLabel: overrides.trackLabel !== undefined ? overrides.trackLabel : (prev.trackLabel || null),
      currentTime: Number.isFinite(Number(audioElement?.currentTime))
        ? Number(audioElement.currentTime)
        : (Number(prev.currentTime) || 0),
      duration: Number.isFinite(Number(audioElement?.duration))
        ? Number(audioElement.duration)
        : (Number(prev.duration) || 0),
      paused: audioElement ? Boolean(audioElement.paused) : nextStatus !== 'playing',
      ended: audioElement ? Boolean(audioElement.ended) : nextStatus === 'ended',
      error: overrides.error !== undefined ? overrides.error : (prev.error || null),
      updatedAt: Date.now()
    };
    return state.musicPlayback;
  }

  function ensureRendererMusicPlayer() {
    if (rendererMusicPlayer) {
      return rendererMusicPlayer;
    }
    const factory = window.RendererMusicPlayer?.createRendererMusicPlayer;
    if (typeof factory !== 'function') {
      throw createRpcError(-32005, 'RendererMusicPlayer runtime is unavailable');
    }
    rendererMusicPlayer = factory();
    syncMusicPlaybackState({ status: 'idle' });
    if (!rendererMusicEventsBound && rendererMusicPlayer.audioElement) {
      const audioElement = rendererMusicPlayer.audioElement;
      audioElement.addEventListener('play', () => {
        syncMusicPlaybackState({ status: 'playing', error: null });
      });
      audioElement.addEventListener('pause', () => {
        syncMusicPlaybackState({
          status: audioElement.ended ? 'ended' : (rendererMusicPlayer.currentSrc ? 'paused' : 'stopped')
        });
      });
      audioElement.addEventListener('ended', () => {
        syncMusicPlaybackState({ status: 'ended' });
      });
      audioElement.addEventListener('timeupdate', () => {
        syncMusicPlaybackState();
      });
      audioElement.addEventListener('loadedmetadata', () => {
        syncMusicPlaybackState();
      });
      audioElement.addEventListener('error', () => {
        const mediaError = audioElement.error;
        syncMusicPlaybackState({
          status: 'error',
          error: mediaError
            ? { code: mediaError.code, message: mediaError.message || 'audio playback error' }
            : { message: 'audio playback error' }
        });
      });
      rendererMusicEventsBound = true;
    }
    return rendererMusicPlayer;
  }

  function buildPresenterActionFrame(nowMs = Date.now()) {
    if (!activePresenterAction) {
      return null;
    }
    const durationSec = Math.max(0, Number(activePresenterAction.durationSec) || 0);
    const elapsedMs = Math.max(0, nowMs - Number(activePresenterAction.startedAt || nowMs));
    const progress = durationSec > 0
      ? clamp(elapsedMs / Math.max(1, durationSec * 1000), 0, 1)
      : 0;
    return {
      type: activePresenterAction.type || 'motion',
      name: activePresenterAction.name || null,
      durationSec,
      queuePolicy: activePresenterAction.queuePolicy || null,
      intensity: clamp(Number(activePresenterAction.intensity) || 0.42, 0, 1),
      progress,
      timestamp: nowMs
    };
  }

  function renderWaveformSnapshot(snapshot) {
    const layer = ensureWaveformLayer();
    if (!layer) {
      return;
    }

    const geometry = snapshot?.geometry || null;
    const visuals = [
      waveformBackdropGraphic,
      waveformGlowGraphic,
      waveformFillGraphic,
      waveformStrokeGraphic,
      waveformCenterGraphic
    ];
    for (const graphic of visuals) {
      graphic?.clear?.();
    }

    if (!snapshot?.waveformVisible || !geometry) {
      layer.visible = false;
      return;
    }

    const originX = Number(geometry.originX) || 0;
    const originY = Number(geometry.originY) || 0;
    for (const graphic of visuals) {
      if (graphic?.position?.set) {
        graphic.position.set(originX, originY);
      }
    }

    const width = Math.max(1, Number(geometry.width) || 1);
    const height = Math.max(1, Number(geometry.height) || 1);
    const primary = Number(snapshot.colors?.primary) || 0x80e3ff;
    const fill = Number(snapshot.colors?.fill) || 0x112330;
    const glow = Number(snapshot.colors?.glow) || primary;
    const accent = Number(snapshot.colors?.accent) || 0xebfbff;
    const energy = clamp(Number(snapshot.energy) || 0, 0, 1);
    const waveformAlpha = clamp(Number(snapshot.waveformAlpha) || 0, 0, 1);
    const housingY = Math.round(height * 0.18);
    const housingHeight = Math.max(28, Math.round(height * 0.64));
    const railY = Math.round(height * 0.5);
    const inset = 10;

    waveformBackdropGraphic.beginFill(0x0a1118, 0.78 * waveformAlpha);
    waveformBackdropGraphic.drawRoundedRect(0, housingY, width, housingHeight, Math.round(housingHeight * 0.48));
    waveformBackdropGraphic.endFill();
    waveformBackdropGraphic.beginFill(fill, 0.42 * waveformAlpha);
    waveformBackdropGraphic.drawRoundedRect(
      inset,
      housingY + 6,
      Math.max(12, width - inset * 2),
      Math.max(16, housingHeight - 12),
      Math.round(housingHeight * 0.36)
    );
    waveformBackdropGraphic.endFill();
    waveformBackdropGraphic.lineStyle(1, accent, 0.12 * waveformAlpha, 0.5);
    waveformBackdropGraphic.moveTo(20, housingY + 12);
    waveformBackdropGraphic.lineTo(width - 20, housingY + 12);
    waveformBackdropGraphic.moveTo(20, housingY + housingHeight - 12);
    waveformBackdropGraphic.lineTo(width - 20, housingY + housingHeight - 12);

    waveformGlowGraphic.lineStyle(12 + energy * 7, glow, (0.08 + energy * 0.12) * waveformAlpha, 0.5);
    drawWaveformEnvelope(waveformGlowGraphic, geometry);

    waveformFillGraphic.beginFill(primary, (0.08 + energy * 0.08) * waveformAlpha);
    drawWaveformEnvelope(waveformFillGraphic, geometry);
    waveformFillGraphic.endFill();
    waveformFillGraphic.beginFill(0xb9eaf7, (0.03 + energy * 0.03) * waveformAlpha);
    waveformFillGraphic.drawRoundedRect(
      Math.round(width * 0.24),
      Math.round(railY - 2),
      Math.round(width * 0.52),
      4,
      2
    );
    waveformFillGraphic.endFill();

    waveformStrokeGraphic.lineStyle(1.5, primary, (0.86 + energy * 0.12) * waveformAlpha, 0.5);
    drawWaveformEnvelope(waveformStrokeGraphic, geometry);
    waveformStrokeGraphic.lineStyle(1, accent, 0.3 * waveformAlpha, 0.5);
    waveformStrokeGraphic.moveTo(26, railY);
    waveformStrokeGraphic.lineTo(width - 26, railY);

    waveformCenterGraphic.lineStyle(1.2, accent, (0.38 + energy * 0.18) * waveformAlpha, 0.5);
    drawPolyline(waveformCenterGraphic, Array.isArray(geometry.centerLine) ? geometry.centerLine : []);
    waveformCenterGraphic.beginFill(accent, (0.16 + energy * 0.14) * waveformAlpha);
    waveformCenterGraphic.drawCircle(18, railY, 2.5);
    waveformCenterGraphic.drawCircle(width - 18, railY, 2.5);
    waveformCenterGraphic.endFill();

    layer.visible = true;
    layer.alpha = waveformAlpha;
  }

  function updatePresenterVisualState(snapshot) {
    renderWaveformSnapshot(snapshot);

    if (live2dModel) {
      live2dModel.alpha = clamp(Number(snapshot?.modelAlpha) || 0, 0, 1);
      live2dModel.visible = live2dModel.alpha > 0.01;
      if ('interactive' in live2dModel) {
        live2dModel.interactive = live2dModel.visible;
      }
      if ('eventMode' in live2dModel) {
        live2dModel.eventMode = live2dModel.visible ? 'static' : 'none';
      }
    }
  }

  function updatePresenterFrame() {
    const bus = ensureAudioFrameBus();
    const presenter = ensureWaveformPresenter();
    if (!bus || !presenter || !pixiApp) {
      return;
    }

    if (rendererMusicPlayer) {
      bus.setMusicFrame(rendererMusicPlayer.sampleFrame({
        bandCount: 24
      }));
      syncMusicPlaybackState();
    }

    const actionFrame = buildPresenterActionFrame();
    bus.setActionFrame(actionFrame);

    const busSnapshot = bus.snapshot();
    presenter.setMode(busSnapshot.mode);
    presenter.ingestSpeechFrame(busSnapshot.speechFrame);
    presenter.ingestMusicFrame(busSnapshot.musicFrame);
    presenter.ingestActionFrame(busSnapshot.actionFrame);

    const stageSize = getStageSize();
    const snapshot = presenter.tick({
      nowMs: Date.now(),
      stageWidth: stageSize.width,
      stageHeight: stageSize.height
    });
    state.presenterMode = snapshot.mode;
    updatePresenterVisualState(snapshot);
  }

  function ensurePresenterTickerHook() {
    if (waveformTickerHookBound || !pixiApp?.ticker) {
      return;
    }
    pixiApp.ticker.add(updatePresenterFrame);
    waveformTickerHookBound = true;
  }

  function setPresenterMode(params = {}) {
    const requestedMode = typeof params === 'string' ? params : (params.mode || params.presenterMode);
    const normalizedMode = normalizePresenterModeValue(requestedMode, getConfiguredPresenterMode());
    runtimeUiConfig = {
      ...(runtimeUiConfig || {}),
      presenter: {
        ...(runtimeUiConfig?.presenter || {}),
        mode: normalizedMode
      }
    };
    state.presenterMode = normalizedMode;
    ensureAudioFrameBus()?.setMode(normalizedMode);
    ensureWaveformPresenter()?.setMode(normalizedMode);
    updatePresenterFrame();
    return getPresenterState();
  }

  function getPresenterState() {
    const snapshot = waveformPresenter?.getLastSnapshot?.() || null;
    return {
      mode: state.presenterMode,
      sourceKind: snapshot?.sourceKind || 'breath',
      waveformVisible: Boolean(snapshot?.waveformVisible),
      modelVisible: Boolean(snapshot?.modelVisible),
      waveformAlpha: Number(snapshot?.waveformAlpha) || 0,
      modelAlpha: Number(snapshot?.modelAlpha) || 0,
      music: state.musicPlayback ? { ...state.musicPlayback } : null
    };
  }

  function setSpeechPresenterFrame(frame) {
    ensureAudioFrameBus()?.setSpeechFrame(frame);
  }

  function clearSpeechPresenterFrame() {
    const basePose = getDefaultMouthBasePose();
    setSpeechPresenterFrame({
      speaking: false,
      energy: 0,
      mouthOpen: basePose.mouthOpen,
      mouthForm: basePose.mouthForm,
      confidence: 0,
      visemeWeights: { a: 0.2, i: 0.2, u: 0.2, e: 0.2, o: 0.2 }
    });
  }

  function queuePresenterAction(actionMessage, actionId) {
    const normalizedAction = actionMessage && typeof actionMessage === 'object' ? actionMessage : null;
    if (!normalizedAction) {
      return;
    }
    const action = normalizedAction.action && typeof normalizedAction.action === 'object'
      ? normalizedAction.action
      : normalizedAction;
    const key = String(actionId || normalizedAction.action_id || '').trim();
    const record = {
      type: String(action.type || normalizedAction.action_type || 'motion').trim().toLowerCase() || 'motion',
      name: action.name || normalizedAction.name || null,
      durationSec: Number(normalizedAction.duration_sec || normalizedAction.durationSec || action.durationSec) || 0,
      queuePolicy: normalizedAction.queue_policy || normalizedAction.queuePolicy || null,
      intensity: clamp(Number(normalizedAction.intensity) || 0.42, 0, 1),
      startedAt: Date.now()
    };
    if (!key) {
      activePresenterAction = record;
      return;
    }
    queuedPresenterActions.set(key, record);
  }

  function applyPresenterActionTelemetry(payload = {}) {
    const event = String(payload.event || '').trim().toLowerCase();
    const actionId = String(payload.action_id || payload.actionId || '').trim();
    if (event === 'start') {
      const queued = actionId ? queuedPresenterActions.get(actionId) : null;
      activePresenterAction = queued
        ? { ...queued, startedAt: Date.now() }
        : {
            type: String(payload.action_type || 'motion').trim().toLowerCase() || 'motion',
            name: null,
            durationSec: 0,
            queuePolicy: null,
            intensity: 0.42,
            startedAt: Date.now()
          };
      return;
    }
    if (event === 'done' || event === 'fail') {
      if (actionId) {
        queuedPresenterActions.delete(actionId);
      }
      activePresenterAction = null;
    }
  }

  async function playWorkspaceMusic(params = {}) {
    const audioUrl = String(params.audioUrl || params.audio_url || '').trim();
    if (!audioUrl) {
      throw createRpcError(-32602, 'desktop.music.play requires audioUrl');
    }
    const pathValue = String(params.path || '').trim() || null;
    const requestedVolume = Number(params.volume);
    const volume = clamp(Number.isFinite(requestedVolume) ? requestedVolume : 1, 0, 1);
    const loop = params.loop === true;
    const trackLabel = String(params.trackLabel || params.track_label || '').trim()
      || (pathValue ? pathValue.split(/[\\/]/).pop() : 'workspace-audio');
    const player = ensureRendererMusicPlayer();
    try {
      await player.play({
        src: audioUrl,
        volume,
        loop
      });
      syncMusicPlaybackState({
        status: 'playing',
        path: pathValue,
        audioUrl,
        volume,
        loop,
        trackLabel,
        error: null
      });
      return { ...state.musicPlayback };
    } catch (error) {
      syncMusicPlaybackState({
        status: 'error',
        path: pathValue,
        audioUrl,
        volume,
        loop,
        trackLabel,
        error: { message: error?.message || String(error || 'music playback failed') }
      });
      throw createRpcError(-32005, error?.message || String(error || 'music playback failed'));
    }
  }

  function getMusicPlaybackState() {
    syncMusicPlaybackState();
    return state.musicPlayback ? { ...state.musicPlayback } : null;
  }

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

  function resetAdaptiveLayoutState() {
    stableModelScale = null;
    stableModelPose = null;
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

  function getDefaultMouthBasePose() {
    return normalizeMouthTunerValues(DEFAULT_MOUTH_BASE_POSE);
  }

  function syncLipsyncStateToDefaultMouthBasePose() {
    const basePose = getDefaultMouthBasePose();
    lipsyncTargetMouthOpen = basePose.mouthOpen;
    lipsyncTargetMouthForm = basePose.mouthForm;
    lipsyncCurrentMouthOpen = basePose.mouthOpen;
    lipsyncCurrentMouthForm = basePose.mouthForm;
    lipsyncBaselineMouthOpen = basePose.mouthOpen;
    lipsyncBaselineMouthForm = basePose.mouthForm;
    lipsyncOpenDeadzoneActive = false;
    return basePose;
  }

  function normalizeFaceBlendValues(input = {}) {
    return {
      mouthForm: Math.round(clamp(Number(input.mouthForm) || 0, -1, 1) * 100) / 100,
      eyeSmileL: Math.round(clamp(Number(input.eyeSmileL) || 0, 0, 1) * 100) / 100,
      eyeSmileR: Math.round(clamp(Number(input.eyeSmileR) || 0, 0, 1) * 100) / 100,
      cheek: Math.round(clamp(Number(input.cheek) || 0, 0, 1) * 100) / 100
    };
  }

  function createFaceBlendValues(input = {}) {
    return normalizeFaceBlendValues({
      ...FACE_BLEND_DEFAULTS,
      ...(input && typeof input === 'object' ? input : {})
    });
  }

  function isMixableFaceParam(name) {
    return [
      'ParamMouthForm',
      'ParamEyeLSmile',
      'ParamEyeRSmile',
      'ParamCheek'
    ].includes(String(name || ''));
  }

  function mapExpressionNameToFaceBlendTarget(name) {
    switch (String(name || '').trim()) {
      case 'smile':
        return createFaceBlendValues({
          mouthForm: 0.28,
          eyeSmileL: 0.92,
          eyeSmileR: 0.92,
          cheek: 0.2
        });
      case 'narrow_eyes':
        return createFaceBlendValues({
          mouthForm: 0.04,
          eyeSmileL: 0.12,
          eyeSmileR: 0.12,
          cheek: 0.08
        });
      case 'tear_drop':
        return createFaceBlendValues({
          mouthForm: -0.04,
          eyeSmileL: 0,
          eyeSmileR: 0,
          cheek: 0
        });
      case 'tears':
        return createFaceBlendValues({
          mouthForm: -0.08,
          eyeSmileL: 0,
          eyeSmileR: 0,
          cheek: 0
        });
      default:
        return createFaceBlendValues();
    }
  }

  function setFaceBlendTarget(nextValues = {}, { replace = false } = {}) {
    const target = replace
      ? { ...FACE_BLEND_DEFAULTS, ...(nextValues || {}) }
      : { ...faceBlendState.target, ...(nextValues || {}) };
    faceBlendState.target = createFaceBlendValues(target);
    return faceBlendState.target;
  }

  function resetFaceBlendTarget() {
    faceBlendState.target = createFaceBlendValues();
    return faceBlendState.target;
  }

  function isVoiceFaceContextActive() {
    return Boolean(activeVoiceRequestId || lipsyncAnimationFrame || lipsyncReleaseAnimationFrame || lipsyncSpeakingActive);
  }

  function stepFaceBlendState() {
    const next = {};
    for (const key of Object.keys(FACE_BLEND_DEFAULTS)) {
      const current = Number(faceBlendState.current?.[key]) || 0;
      const target = Number(faceBlendState.target?.[key]) || 0;
      const alpha = Math.abs(target) > Math.abs(current) ? FACE_BLEND_ATTACK : FACE_BLEND_RELEASE;
      next[key] = lerp(current, target, alpha);
    }
    faceBlendState.current = createFaceBlendValues(next);
    return faceBlendState.current;
  }

  function applyCompositeFacePoseToModel({ mouthOpen = null, mouthForm = null, speaking = false } = {}) {
    if (!live2dModel || !state.modelLoaded) {
      return { ok: false, skipped: true, reason: 'model_not_loaded' };
    }
    const coreModel = live2dModel?.internalModel?.coreModel;
    if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
      return { ok: false, skipped: true, reason: 'core_model_unavailable' };
    }
    const basePose = getDefaultMouthBasePose();
    const faceBlend = stepFaceBlendState();
    const voiceFaceContext = isVoiceFaceContextActive() || Boolean(speaking);
    const emotionMouthWeight = voiceFaceContext ? FACE_BLEND_SPEECH_MOUTHFORM_WEIGHT : 1;
    const resolvedMouthOpen = clamp(Number.isFinite(Number(mouthOpen)) ? Number(mouthOpen) : basePose.mouthOpen, 0, 1);
    const resolvedMouthForm = clamp(Number.isFinite(Number(mouthForm)) ? Number(mouthForm) : basePose.mouthForm, -1, 1);
    const finalMouthForm = clamp(
      resolvedMouthForm + faceBlend.mouthForm * emotionMouthWeight,
      -1,
      1
    );

    try {
      coreModel.setParameterValueById('ParamMouthOpenY', resolvedMouthOpen);
      coreModel.setParameterValueById('ParamMouthForm', finalMouthForm);
      coreModel.setParameterValueById('ParamEyeLSmile', faceBlend.eyeSmileL);
      coreModel.setParameterValueById('ParamEyeRSmile', faceBlend.eyeSmileR);
      coreModel.setParameterValueById('ParamCheek', faceBlend.cheek);
      return {
        ok: true,
        values: {
          mouthOpen: resolvedMouthOpen,
          mouthForm: finalMouthForm,
          faceBlend
        }
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err || 'unknown error')
      };
    }
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

  function getWaveformCaptureRuntimeConfig() {
    const raw = runtimeUiConfig?.debug?.waveformCapture;
    const config = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: config.enabled === true,
      captureEveryFrame: config.captureEveryFrame !== false,
      includeApplied: config.includeApplied !== false
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

  function applyRawMouthPoseToModel(values = {}, { force = false } = {}) {
    if (!live2dModel || !state.modelLoaded) {
      return { ok: false, skipped: true, reason: 'model_not_loaded' };
    }
    const coreModel = live2dModel?.internalModel?.coreModel;
    if (!coreModel) {
      return { ok: false, skipped: true, reason: 'core_model_unavailable' };
    }
    const normalized = normalizeMouthTunerValues(values);
    try {
      if (force || typeof coreModel.addParameterValueById !== 'function') {
        coreModel.setParameterValueById('ParamMouthOpenY', normalized.mouthOpen);
        coreModel.setParameterValueById('ParamMouthForm', normalized.mouthForm);
      } else {
        coreModel.addParameterValueById('ParamMouthOpenY', normalized.mouthOpen, 1);
        coreModel.addParameterValueById('ParamMouthForm', normalized.mouthForm, 1);
      }
      return {
        ok: true,
        values: normalized
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err || 'unknown error'),
        values: normalized
      };
    }
  }

  function getActiveMouthOverrideValues() {
    if (externalMouthOverrideState?.enabled) {
      return externalMouthOverrideState.values || normalizeMouthTunerValues();
    }
    if (mouthTunerState?.enabled) {
      return mouthTunerState.values || normalizeMouthTunerValues();
    }
    return null;
  }

  function applyActiveMouthOverrideForCurrentFrame() {
    const overrideValues = getActiveMouthOverrideValues();
    if (!overrideValues) {
      return false;
    }
    lipsyncCurrentMouthOpen = overrideValues.mouthOpen;
    lipsyncCurrentMouthForm = overrideValues.mouthForm;
    return applyCompositeFacePoseToModel({
      mouthOpen: overrideValues.mouthOpen,
      mouthForm: overrideValues.mouthForm,
      speaking: lipsyncSpeakingActive
    }).ok === true;
  }

  function shouldApplyDefaultMouthBasePose() {
    if (getActiveMouthOverrideValues()) {
      return false;
    }
    if (lipsyncReleaseAnimationFrame || lipsyncSpeakingActive) {
      return false;
    }
    if (lipsyncAnimationFrame) {
      return false;
    }
    return true;
  }

  function applyDefaultMouthBasePoseForCurrentFrame() {
    const basePose = syncLipsyncStateToDefaultMouthBasePose();
    return applyCompositeFacePoseToModel({
      mouthOpen: basePose.mouthOpen,
      mouthForm: basePose.mouthForm,
      speaking: false
    }).ok === true;
  }

  function bindPersistentMouthOverrideHook() {
    if (typeof mouthOverrideDetachModelHook === 'function' || typeof mouthOverrideDetachTickerHook === 'function') {
      return true;
    }
    const internalModel = live2dModel?.internalModel;
    if (internalModel && typeof internalModel.on === 'function') {
      const handler = () => {
        if (applyActiveMouthOverrideForCurrentFrame()) {
          return;
        }
        if (shouldApplyDefaultMouthBasePose()) {
          applyDefaultMouthBasePoseForCurrentFrame();
        }
      };
      internalModel.on('beforeModelUpdate', handler);
      mouthOverrideDetachModelHook = () => {
        if (typeof internalModel.off === 'function') {
          internalModel.off('beforeModelUpdate', handler);
        } else if (typeof internalModel.removeListener === 'function') {
          internalModel.removeListener('beforeModelUpdate', handler);
        }
      };
      return true;
    }
    if (pixiApp?.ticker && typeof pixiApp.ticker.add === 'function') {
      const tick = () => {
        if (applyActiveMouthOverrideForCurrentFrame()) {
          return;
        }
        if (shouldApplyDefaultMouthBasePose()) {
          applyDefaultMouthBasePoseForCurrentFrame();
        }
      };
      pixiApp.ticker.add(tick);
      mouthOverrideDetachTickerHook = () => {
        if (pixiApp?.ticker && typeof pixiApp.ticker.remove === 'function') {
          pixiApp.ticker.remove(tick);
        }
      };
      return true;
    }
    return false;
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
      applyRawMouthPoseToModel(mouthTunerState.values, { force: true });
    }
  }

  function setMouthTunerEnabled(enabled, { immediate = false, statusMessage = '' } = {}) {
    mouthTunerState.enabled = Boolean(enabled);
    syncMouthTunerControls();
    if (mouthTunerState.enabled) {
      setMouthTunerStatus(statusMessage || 'Override active');
      if (immediate) {
        applyRawMouthPoseToModel(mouthTunerState.values, { force: true });
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
      applyRawMouthPoseToModel(externalMouthOverrideState.values, { force: true });
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
      setMouthTunerEnabled(true, {
        immediate: true,
        statusMessage: 'Override active'
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
    resetAdaptiveLayoutState();
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

  function applyWindowState(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const previousResizeModeEnabled = state.resizeModeEnabled;
    const previousWindowState = state.windowState;

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
    if (state.resizeModeEnabled && (!previousResizeModeEnabled || !resizeModeBaseWindowSize)) {
      resizeModeBaseWindowSize = {
        width: Number(state.windowState.width) || Number(previousWindowState?.width) || window.innerWidth || null,
        height: Number(state.windowState.height) || Number(previousWindowState?.height) || window.innerHeight || null,
        aspectRatio: Number(state.windowState.aspectRatio) || null
      };
    }

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
      resizeModeBaseWindowSize = null;
      lastResizeModeRequest = null;
      setLayoutTunerOpen(false);
      setDragZonePanelOpen(false);
    }
    syncDragZoneVisual(dragZoneTunerState?.values || getCurrentDragZoneValues());
    syncWindowInteractivityFromPointer();
    if (
      previousResizeModeEnabled !== state.resizeModeEnabled
      || Number(previousWindowState?.width) !== Number(state.windowState?.width)
      || Number(previousWindowState?.height) !== Number(state.windowState?.height)
    ) {
      scheduleAdaptiveLayout();
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
      if (!layoutTunerState?.open) {
        setDragZonePanelOpen(false);
      }
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

  function normalizeDragZoneValues(input = {}) {
    const widthRatio = Math.round(clamp(Number(input.widthRatio) || 0, 0.1, 0.9) * 1000) / 1000;
    const heightRatio = Math.round(clamp(Number(input.heightRatio) || 0, 0.1, 0.9) * 1000) / 1000;
    return {
      centerXRatio: Math.round(clamp(Number(input.centerXRatio) || 0, widthRatio / 2, 1 - widthRatio / 2) * 1000) / 1000,
      centerYRatio: Math.round(clamp(Number(input.centerYRatio) || 0, heightRatio / 2, 1 - heightRatio / 2) * 1000) / 1000,
      widthRatio,
      heightRatio
    };
  }

  function toDragZoneDisplayValues(values = {}) {
    return {
      centerXPercent: Math.round((Number(values.centerXRatio) || 0) * 100),
      centerYPercent: Math.round((Number(values.centerYRatio) || 0) * 100),
      widthPercent: Math.round((Number(values.widthRatio) || 0) * 100),
      heightPercent: Math.round((Number(values.heightRatio) || 0) * 100)
    };
  }

  function ensureRuntimeDragZoneConfig() {
    runtimeUiConfig = runtimeUiConfig && typeof runtimeUiConfig === 'object' ? runtimeUiConfig : {};
    runtimeUiConfig.interaction = {
      ...(runtimeUiConfig.interaction || {}),
      dragZone: {
        ...(dragZoneDefaults || {}),
        ...(runtimeUiConfig?.interaction?.dragZone || {})
      }
    };
    return runtimeUiConfig.interaction.dragZone;
  }

  function getCurrentDragZoneValues() {
    const dragZoneConfig = ensureRuntimeDragZoneConfig();
    return normalizeDragZoneValues({
      centerXRatio: dragZoneConfig.centerXRatio ?? dragZoneDefaults.centerXRatio,
      centerYRatio: dragZoneConfig.centerYRatio ?? dragZoneDefaults.centerYRatio,
      widthRatio: dragZoneConfig.widthRatio ?? dragZoneDefaults.widthRatio,
      heightRatio: dragZoneConfig.heightRatio ?? dragZoneDefaults.heightRatio
    });
  }

  function setDragZoneStatus(message = '') {
    if (dragZoneStatusElement) {
      dragZoneStatusElement.textContent = String(message || '');
    }
  }

  function ensureRuntimeVoiceConfig() {
    runtimeUiConfig = runtimeUiConfig && typeof runtimeUiConfig === 'object' ? runtimeUiConfig : {};
    runtimeUiConfig.voice = {
      ...(window.DesktopLive2dDefaults?.DEFAULT_UI_CONFIG?.voice || {}),
      ...(runtimeUiConfig.voice || {}),
      realtime: {
        ...((window.DesktopLive2dDefaults?.DEFAULT_UI_CONFIG?.voice || {}).realtime || {}),
        ...(runtimeUiConfig?.voice?.realtime || {})
      }
    };
    return runtimeUiConfig.voice;
  }

  function resolveVoiceOutputDelayMs(overrideValue = null) {
    const runtimeVoice = ensureRuntimeVoiceConfig();
    const candidate = overrideValue ?? runtimeVoice.outputDelayMs;
    const parsed = Number(candidate);
    return Number.isFinite(parsed)
      ? Math.max(0, Math.min(500, Math.round(parsed)))
      : 0;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function normalizeLegacyVoiceAudioUrl(audioRef = '') {
    const raw = String(audioRef || '').trim();
    if (!raw) return '';
    if (/^[a-z]+:\/\//i.test(raw)) {
      return raw;
    }
    if (raw.startsWith('/')) {
      return `file://${encodeURI(raw)}`;
    }
    return raw;
  }

  async function primeLipsync(audioElement, options = {}) {
    const started = await startLipsync(audioElement, options);
    return started;
  }

  function syncDragZoneVisual(values) {
    if (!dragZoneVisualElement) {
      return;
    }
    const normalized = normalizeDragZoneValues(values || getCurrentDragZoneValues());
    const leftPercent = (normalized.centerXRatio - normalized.widthRatio / 2) * 100;
    const topPercent = (normalized.centerYRatio - normalized.heightRatio / 2) * 100;
    dragZoneVisualElement.style.left = `${leftPercent}%`;
    dragZoneVisualElement.style.top = `${topPercent}%`;
    dragZoneVisualElement.style.width = `${normalized.widthRatio * 100}%`;
    dragZoneVisualElement.style.height = `${normalized.heightRatio * 100}%`;
    dragZoneVisualElement.style.transform = 'none';
  }

  function syncDragZoneControls() {
    if (!dragZoneTunerState?.values) {
      return;
    }
    const { centerXPercent, centerYPercent, widthPercent, heightPercent } = toDragZoneDisplayValues(dragZoneTunerState.values);
    if (dragZoneCenterXElement) dragZoneCenterXElement.value = String(centerXPercent);
    if (dragZoneCenterYElement) dragZoneCenterYElement.value = String(centerYPercent);
    if (dragZoneWidthElement) dragZoneWidthElement.value = String(widthPercent);
    if (dragZoneHeightElement) dragZoneHeightElement.value = String(heightPercent);
    if (dragZoneCenterXValueElement) dragZoneCenterXValueElement.textContent = `${centerXPercent}%`;
    if (dragZoneCenterYValueElement) dragZoneCenterYValueElement.textContent = `${centerYPercent}%`;
    if (dragZoneWidthValueElement) dragZoneWidthValueElement.textContent = `${widthPercent}%`;
    if (dragZoneHeightValueElement) dragZoneHeightValueElement.textContent = `${heightPercent}%`;
    syncDragZoneVisual(dragZoneTunerState.values);
  }

  function setDragZonePanelOpen(open) {
    const nextOpen = Boolean(open) && state.resizeModeEnabled;
    if (!dragZoneTunerState) {
      dragZoneTunerState = {
        open: nextOpen,
        values: getCurrentDragZoneValues()
      };
    } else {
      dragZoneTunerState.open = nextOpen;
    }
    document.body.classList.toggle('drag-zone-panel-open', nextOpen);
    if (dragZoneToggleElement) {
      dragZoneToggleElement.textContent = nextOpen ? 'Close Drag Zone' : 'Adjust Drag Zone';
    }
    if (!nextOpen) {
      setDragZoneStatus('');
    }
  }

  function applyDragZoneValues(nextValues, { showStatus = false, statusMessage = '' } = {}) {
    const normalized = normalizeDragZoneValues(nextValues);
    const dragZoneConfig = ensureRuntimeDragZoneConfig();
    dragZoneConfig.centerXRatio = normalized.centerXRatio;
    dragZoneConfig.centerYRatio = normalized.centerYRatio;
    dragZoneConfig.widthRatio = normalized.widthRatio;
    dragZoneConfig.heightRatio = normalized.heightRatio;
    if (!dragZoneTunerState) {
      dragZoneTunerState = { open: false, values: normalized };
    } else {
      dragZoneTunerState.values = normalized;
    }
    syncDragZoneControls();
    syncWindowInteractivityFromPointer();
    if (showStatus) {
      setDragZoneStatus(statusMessage);
    }
  }

  function resetDragZoneValues() {
    applyDragZoneValues({
      centerXRatio: dragZoneDefaults.centerXRatio,
      centerYRatio: dragZoneDefaults.centerYRatio,
      widthRatio: dragZoneDefaults.widthRatio,
      heightRatio: dragZoneDefaults.heightRatio
    }, {
      showStatus: true,
      statusMessage: 'Preview reset to defaults'
    });
  }

  function saveDragZoneValues() {
    const values = dragZoneTunerState?.values || getCurrentDragZoneValues();
    bridge?.sendWindowControl?.({
      action: 'save_drag_zone_overrides',
      dragZone: values
    });
    setDragZoneStatus('Saved to desktop-live2d.json');
  }

  function initDragZoneTuner() {
    dragZoneTunerState = {
      open: false,
      values: getCurrentDragZoneValues()
    };
    syncDragZoneControls();
    setDragZonePanelOpen(false);

    dragZoneToggleElement?.addEventListener('click', () => {
      if (!dragZoneTunerState?.open) {
        setLayoutTunerOpen(false);
      }
      setDragZonePanelOpen(!dragZoneTunerState?.open);
    });
    dragZoneCloseElement?.addEventListener('click', () => {
      setDragZonePanelOpen(false);
    });
    dragZoneResetElement?.addEventListener('click', () => {
      resetDragZoneValues();
    });
    dragZoneSaveElement?.addEventListener('click', () => {
      saveDragZoneValues();
    });
    dragZoneCenterXElement?.addEventListener('input', () => {
      applyDragZoneValues({
        ...(dragZoneTunerState?.values || getCurrentDragZoneValues()),
        centerXRatio: roundToStep(dragZoneCenterXElement.value, 1) / 100
      });
    });
    dragZoneCenterYElement?.addEventListener('input', () => {
      applyDragZoneValues({
        ...(dragZoneTunerState?.values || getCurrentDragZoneValues()),
        centerYRatio: roundToStep(dragZoneCenterYElement.value, 1) / 100
      });
    });
    dragZoneWidthElement?.addEventListener('input', () => {
      applyDragZoneValues({
        ...(dragZoneTunerState?.values || getCurrentDragZoneValues()),
        widthRatio: roundToStep(dragZoneWidthElement.value, 1) / 100
      });
    });
    dragZoneHeightElement?.addEventListener('input', () => {
      applyDragZoneValues({
        ...(dragZoneTunerState?.values || getCurrentDragZoneValues()),
        heightRatio: roundToStep(dragZoneHeightElement.value, 1) / 100
      });
    });
  }

  function setBubbleVisible(visible) {
    state.bubbleVisible = visible;
    bubbleElement.classList.toggle('visible', visible);
  }

  function isPointInCenterDragZone(clientX, clientY) {
    const dragZone = dragZoneTunerState?.values || getCurrentDragZoneValues();
    const width = Math.max(1, window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || 1);
    const left = (dragZone.centerXRatio - dragZone.widthRatio / 2) * width;
    const right = (dragZone.centerXRatio + dragZone.widthRatio / 2) * width;
    const top = (dragZone.centerYRatio - dragZone.heightRatio / 2) * height;
    const bottom = (dragZone.centerYRatio + dragZone.heightRatio / 2) * height;
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
  }

  function isPointInsideVisibleElement(element, clientX, clientY) {
    if (!element || element.hidden) {
      return false;
    }
    const style = window.getComputedStyle?.(element);
    if (!style || style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function isPointInInteractiveUi(clientX, clientY) {
    const interactiveElements = [
      mouthTunerToggleElement,
      mouthTunerPanelElement,
      resizeModeCloseElement,
      layoutTunerToggleElement,
      dragZoneToggleElement,
      document.body.classList.contains('layout-tuner-open') ? document.getElementById('layout-tuner-panel') : null,
      document.body.classList.contains('drag-zone-panel-open') ? document.getElementById('drag-zone-panel') : null,
      chatPanelElement?.classList.contains('visible') ? chatPanelElement : null
    ];
    return interactiveElements.some((element) => isPointInsideVisibleElement(element, clientX, clientY));
  }

  function setWindowInteractivity(interactive) {
    if (typeof bridge?.sendWindowInteractivity !== 'function') {
      return;
    }
    const nextInteractive = Boolean(interactive);
    if (lastWindowInteractivity === nextInteractive) {
      return;
    }
    lastWindowInteractivity = nextInteractive;
    bridge.sendWindowInteractivity({ interactive: nextInteractive });
  }

  function syncWindowInteractivityFromPointer(position = lastPointerPosition) {
    if (state.resizeModeEnabled || dragPointerState) {
      setWindowInteractivity(true);
      return;
    }
    if (!position) {
      setWindowInteractivity(false);
      return;
    }
    setWindowInteractivity(
      isPointInCenterDragZone(position.clientX, position.clientY)
      || isPointInInteractiveUi(position.clientX, position.clientY)
    );
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(min, max, t) {
    const ratio = clamp(Number(t) || 0, 0, 1);
    return min + (max - min) * ratio;
  }

  function estimateVoiceEnergy(frequencyData) {
    if (!frequencyData || frequencyData.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < frequencyData.length; i += 1) {
      sum += Number(frequencyData[i]) || 0;
    }
    return clamp(sum / (frequencyData.length * 255), 0, 1);
  }

  function enhanceMouthParams({ mouthOpen = 0, mouthForm = 0, voiceEnergy = 0, speaking = false } = {}) {
    const rawOpen = clamp(Number(mouthOpen) || 0, 0, 1);
    const rawForm = clamp(Number(mouthForm) || 0, -1, 1);
    const energy = clamp(Number(voiceEnergy) || 0, 0, 1);
    const active = Boolean(speaking);
    const intensity = clamp((energy - LIPSYNC_ACTIVE_ENERGY_MIN) / 0.08, 0, 1);

    if (!active) {
      return {
        mouthOpen: rawOpen,
        mouthForm: rawForm
      };
    }

    lipsyncBaselineMouthOpen = clamp(
      lipsyncBaselineMouthOpen + (rawOpen - lipsyncBaselineMouthOpen) * LIPSYNC_BASELINE_OPEN_ALPHA,
      0,
      1
    );
    lipsyncBaselineMouthForm = clamp(
      lipsyncBaselineMouthForm + (rawForm - lipsyncBaselineMouthForm) * LIPSYNC_BASELINE_FORM_ALPHA,
      -1,
      1
    );

    const openGain = lerp(LIPSYNC_VARIANCE_OPEN_GAIN_MIN, LIPSYNC_VARIANCE_OPEN_GAIN_MAX, intensity);
    const formGain = lerp(LIPSYNC_VARIANCE_FORM_GAIN_MIN, LIPSYNC_VARIANCE_FORM_GAIN_MAX, intensity);
    const openDelta = rawOpen - lipsyncBaselineMouthOpen;
    const formDelta = rawForm - lipsyncBaselineMouthForm;
    const positiveOpenDelta = Math.max(0, openDelta) * openGain;
    const negativeOpenDelta = Math.min(0, openDelta) * LIPSYNC_VARIANCE_OPEN_NEGATIVE_GAIN;
    const speakingOpenFloor = clamp(lipsyncBaselineMouthOpen * LIPSYNC_SPEAKING_OPEN_FLOOR_RATIO, 0, 1);
    const boostedOpen = clamp(
      Math.max(
        speakingOpenFloor,
        lipsyncBaselineMouthOpen + positiveOpenDelta + negativeOpenDelta
      ),
      0,
      1
    );
    const boostedForm = clamp(lipsyncBaselineMouthForm + formDelta * formGain, -1, 1);

    return {
      mouthOpen: boostedOpen,
      mouthForm: boostedForm
    };
  }

  function applyMouthOpenDeadzone({ mouthOpen = 0, speaking = false } = {}) {
    const open = clamp(Number(mouthOpen) || 0, 0, 1);
    const active = Boolean(speaking);

    if (lipsyncOpenDeadzoneActive) {
      if (open >= LIPSYNC_OPEN_DEADZONE_EXIT) {
        lipsyncOpenDeadzoneActive = false;
        return open;
      }
      return 0;
    }

    if (open <= LIPSYNC_OPEN_DEADZONE_ENTER && (!active || open <= LIPSYNC_OPEN_DEADZONE_EXIT)) {
      lipsyncOpenDeadzoneActive = true;
      return 0;
    }

    return open;
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

  function ensureRealtimeVoicePlayer() {
    if (realtimeVoicePlayer) {
      return realtimeVoicePlayer;
    }
    const PlayerCtor = window.RealtimeVoicePlayer;
    if (typeof PlayerCtor !== 'function') {
      return null;
    }
    realtimeVoicePlayer = new PlayerCtor();
    return realtimeVoicePlayer;
  }

  function interruptRealtimeVoicePlayer(reason = 'interrupted') {
    if (!realtimeVoicePlayer || typeof realtimeVoicePlayer.interruptSession !== 'function') {
      return;
    }
    try {
      realtimeVoicePlayer.interruptSession({ reason: String(reason || 'interrupted') });
    } catch {
      // ignore realtime interrupt failures
    }
  }

  function normalizeVoiceRequestId(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, 128);
  }

  function emitLipsyncTelemetry(eventName, meta = {}) {
    if (typeof bridge?.sendLipsyncTelemetry !== 'function') {
      return;
    }
    const event = String(eventName || '').trim().toLowerCase();
    if (!event) {
      return;
    }
    const payload = {
      event,
      timestamp: Date.now()
    };
    const requestId = normalizeVoiceRequestId(meta.request_id || meta.requestId) || activeVoiceRequestId;
    if (requestId) {
      payload.request_id = requestId;
    }
    for (const [key, value] of Object.entries(meta)) {
      if (key === 'request_id' || key === 'requestId' || value === undefined) {
        continue;
      }
      payload[key] = value;
    }
    try {
      bridge.sendLipsyncTelemetry(payload);
    } catch (err) {
      console.warn('[lipsync] failed to send telemetry', err);
    }
  }

  function emitRendererDebug(eventName, meta = {}) {
    const event = String(eventName || '').trim().toLowerCase();
    if (!event) {
      return;
    }
    const payload = {
      event,
      timestamp: Date.now(),
      ...meta
    };
    try {
      console.log(`[renderer-debug] ${JSON.stringify(payload)}`);
    } catch {
      // ignore debug serialization errors
    }
  }

  function snapshotSystemAudioState() {
    return {
      paused: !!systemAudio.paused,
      muted: !!systemAudio.muted,
      volume: Number(systemAudio.volume),
      current_time: Number(systemAudio.currentTime) || 0,
      duration: Number.isFinite(Number(systemAudio.duration)) ? Number(systemAudio.duration) : null,
      ready_state: Number(systemAudio.readyState),
      network_state: Number(systemAudio.networkState)
    };
  }

  function probeModelMouthParams() {
    const summary = {
      has_model: !!live2dModel,
      has_core_model: false,
      has_parameter_ids_api: false,
      has_mouth_open_param: null,
      has_mouth_form_param: null,
      parameter_count: null,
      error: null
    };
    try {
      const coreModel = live2dModel?.internalModel?.coreModel;
      if (!coreModel) {
        return summary;
      }
      summary.has_core_model = true;
      const ids = coreModel.getParameterIds?.();
      if (Array.isArray(ids)) {
        summary.has_parameter_ids_api = true;
        summary.parameter_count = ids.length;
        summary.has_mouth_open_param = ids.includes('ParamMouthOpenY');
        summary.has_mouth_form_param = ids.includes('ParamMouthForm');
      }
      return summary;
    } catch (err) {
      summary.error = err?.message || String(err || 'unknown error');
      return summary;
    }
  }

  function bindSystemAudioDebugEvents() {
    if (systemAudioDebugBound) {
      return;
    }
    systemAudioDebugBound = true;
    const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'stalled', 'suspend', 'waiting', 'ended', 'error'];
    for (const eventName of events) {
      systemAudio.addEventListener(eventName, () => {
        emitRendererDebug('voice_memory.audio_event', {
          event_type: eventName,
          ...snapshotSystemAudioState(),
          error_code: systemAudio.error?.code || null,
          error_message: systemAudio.error?.message || null
        });
      });
    }
  }

  function cancelLipsyncReleaseLoop() {
    if (lipsyncReleaseAnimationFrame) {
      cancelAnimationFrame(lipsyncReleaseAnimationFrame);
      lipsyncReleaseAnimationFrame = null;
    }
  }

  function resetLipsyncMouthState() {
    syncLipsyncStateToDefaultMouthBasePose();
    lipsyncSpeakingActive = false;
    clearSpeechPresenterFrame();
  }

  function applyLipsyncValuesToModel({ source = 'unknown' } = {}) {
    if (getActiveMouthOverrideValues()) {
      return applyActiveMouthOverrideForCurrentFrame();
    }
    const transitioned = typeof mouthTransitionApi?.stepMouthTransition === 'function'
      ? mouthTransitionApi.stepMouthTransition({
        current: {
          mouthOpen: lipsyncCurrentMouthOpen,
          mouthForm: lipsyncCurrentMouthForm
        },
        target: {
          mouthOpen: lipsyncTargetMouthOpen,
          mouthForm: lipsyncTargetMouthForm
        },
        speaking: lipsyncSpeakingActive
      })
      : {
        mouthOpen: lipsyncTargetMouthOpen,
        mouthForm: lipsyncTargetMouthForm
      };
    lipsyncCurrentMouthOpen = clamp(Number(transitioned.mouthOpen) || 0, 0, 1);
    lipsyncCurrentMouthForm = clamp(Number(transitioned.mouthForm) || 0, -1, 1);
    const result = applyCompositeFacePoseToModel({
      mouthOpen: lipsyncCurrentMouthOpen,
      mouthForm: lipsyncCurrentMouthForm,
      speaking: lipsyncSpeakingActive
    });
    if (!result.ok) {
      emitLipsyncTelemetry('frame.apply_failed', {
        error: result.error || 'apply_failed',
        mouth_open: lipsyncCurrentMouthOpen,
        mouth_form: lipsyncCurrentMouthForm,
        reason: `apply_${source}_failed`
      });
    }
    return result.ok === true;
  }

  function detachLipsyncModelHook() {
    if (typeof lipsyncDetachModelHook === 'function') {
      lipsyncDetachModelHook();
      lipsyncDetachModelHook = null;
      emitRendererDebug('lipsync.model_hook_detached', {
        request_id: activeVoiceRequestId
      });
    }
  }

  function detachLipsyncTickerHook() {
    if (typeof lipsyncDetachTickerHook === 'function') {
      lipsyncDetachTickerHook();
      lipsyncDetachTickerHook = null;
      emitRendererDebug('lipsync.ticker_hook_detached', {
        request_id: activeVoiceRequestId
      });
    }
  }

  function bindLipsyncModelHook() {
    if (typeof lipsyncDetachModelHook === 'function') {
      return true;
    }
    const internalModel = live2dModel?.internalModel;
    if (!internalModel || typeof internalModel.on !== 'function') {
      return false;
    }
    const handler = () => {
      applyLipsyncValuesToModel({ source: 'before_model_update' });
    };
    internalModel.on('beforeModelUpdate', handler);
    lipsyncDetachModelHook = () => {
      if (typeof internalModel.off === 'function') {
        internalModel.off('beforeModelUpdate', handler);
      } else if (typeof internalModel.removeListener === 'function') {
        internalModel.removeListener('beforeModelUpdate', handler);
      }
    };
    emitRendererDebug('lipsync.model_hook_bound', {
      request_id: activeVoiceRequestId
    });
    return true;
  }

  function bindLipsyncTickerHook() {
    if (typeof lipsyncDetachTickerHook === 'function') {
      return true;
    }
    if (!pixiApp?.ticker || typeof pixiApp.ticker.add !== 'function') {
      return false;
    }
    const tick = () => {
      applyLipsyncValuesToModel({ source: 'ticker' });
    };
    pixiApp.ticker.add(tick);
    lipsyncDetachTickerHook = () => {
      if (pixiApp?.ticker && typeof pixiApp.ticker.remove === 'function') {
        pixiApp.ticker.remove(tick);
      }
    };
    emitRendererDebug('lipsync.ticker_hook_bound', {
      request_id: activeVoiceRequestId
    });
    return true;
  }

  function finalizeLipsyncStop(reason = 'unspecified') {
    cancelLipsyncReleaseLoop();
    detachLipsyncModelHook();
    detachLipsyncTickerHook();
    resetLipsyncMouthState();
    lipsyncApplyMode = 'raf_direct';

    if (live2dModel) {
      const basePose = getDefaultMouthBasePose();
      const result = applyCompositeFacePoseToModel({
        mouthOpen: basePose.mouthOpen,
        mouthForm: basePose.mouthForm,
        speaking: false
      });
      if (result.ok) {
        console.log('[lipsync] mouth parameters reset to base pose');
        emitLipsyncTelemetry('sync.reset_neutral', {
          has_model: true,
          mouth_open: basePose.mouthOpen,
          mouth_form: basePose.mouthForm,
          reason
        });
      } else {
        console.warn('[lipsync] Failed to reset mouth parameters:', result.error || result.reason);
        emitLipsyncTelemetry('sync.reset_failed', {
          has_model: true,
          reason,
          error: result.error || result.reason || 'unknown error'
        });
      }
    }
  }

  function scheduleLipsyncRelease(reason = 'unspecified') {
    cancelLipsyncReleaseLoop();
    const transitionSettled = typeof mouthTransitionApi?.isMouthTransitionSettled === 'function'
      ? () => mouthTransitionApi.isMouthTransitionSettled({
        current: {
          mouthOpen: lipsyncCurrentMouthOpen,
          mouthForm: lipsyncCurrentMouthForm
        },
        target: {
          mouthOpen: lipsyncTargetMouthOpen,
          mouthForm: lipsyncTargetMouthForm
        }
      })
      : () => (
        Math.abs(lipsyncCurrentMouthOpen) <= 0.01
        && Math.abs(lipsyncCurrentMouthForm) <= 0.01
      );

    const releaseStep = () => {
      if (!live2dModel) {
        finalizeLipsyncStop(reason);
        return;
      }
      if (lipsyncApplyMode === 'raf_direct') {
        applyLipsyncValuesToModel({ source: 'release' });
      }
      if (transitionSettled()) {
        finalizeLipsyncStop(reason);
        return;
      }
      lipsyncReleaseAnimationFrame = requestAnimationFrame(releaseStep);
    };

    if (transitionSettled()) {
      finalizeLipsyncStop(reason);
      return;
    }
    lipsyncReleaseAnimationFrame = requestAnimationFrame(releaseStep);
  }

  function stopLipsync(reason = 'unspecified', meta = {}) {
    const stopState = {
      reason: String(reason || 'unspecified'),
      request_id: activeVoiceRequestId,
      has_animation_frame: !!lipsyncAnimationFrame,
      has_state: !!lipsyncState,
      has_model: !!live2dModel,
      has_audio_context: !!audioContext,
      has_audio_source: !!lipsyncAudioSource,
      has_analyser: !!lipsyncAnalyser,
      ...meta
    };
    console.log('[lipsync] stopLipsync called', {
      reason: stopState.reason,
      requestId: stopState.request_id,
      hasAnimationFrame: stopState.has_animation_frame,
      hasState: stopState.has_state,
      hasModel: stopState.has_model,
      hasAudioContext: stopState.has_audio_context,
      hasAudioSource: stopState.has_audio_source,
      hasAnalyser: stopState.has_analyser
    });
    emitRendererDebug('lipsync.sync_stop', {
      ...stopState,
      ...snapshotSystemAudioState()
    });
    emitLipsyncTelemetry('sync.stop', stopState);

    if (lipsyncAnimationFrame) {
      cancelAnimationFrame(lipsyncAnimationFrame);
      lipsyncAnimationFrame = null;
      console.log('[lipsync] animation frame cancelled');
      emitLipsyncTelemetry('sync.loop_cancelled', {
        has_animation_frame: true,
        reason: stopState.reason
      });
    }
    lipsyncState = null;
    const basePose = getDefaultMouthBasePose();
    lipsyncTargetMouthOpen = basePose.mouthOpen;
    lipsyncTargetMouthForm = basePose.mouthForm;
    lipsyncSpeakingActive = false;
    clearSpeechPresenterFrame();
    scheduleLipsyncRelease(stopState.reason);
    emitRendererDebug('lipsync.sync_stopped', {
      request_id: stopState.request_id,
      reason: stopState.reason,
      ...snapshotSystemAudioState()
    });
  }

  async function startLipsync(audioElement, options = {}) {
    const externalAnalyser = options?.analyserNode || null;
    const externalAudioContext = options?.audioContextInstance || null;
    const speakingResolver = typeof options?.isSpeaking === 'function' ? options.isSpeaking : null;
    const sourceLabel = String(options?.sourceLabel || (audioElement ? 'media_element' : 'external_analyser'));
    console.log('[lipsync] startLipsync called', {
      hasLipsyncApi: !!lipsyncApi,
      hasModel: !!live2dModel,
      hasAudioElement: !!audioElement,
      hasExternalAnalyser: !!externalAnalyser,
      audioSrc: audioElement?.src?.substring(0, 50),
      hasExistingSource: !!lipsyncAudioSource,
      sourceLabel
    });
    emitLipsyncTelemetry('sync.start', {
      has_lipsync_api: !!lipsyncApi,
      has_model: !!live2dModel,
      has_audio_element: !!audioElement,
      has_audio_source: !!lipsyncAudioSource,
      has_external_analyser: !!externalAnalyser,
      source_label: sourceLabel
    });
    cancelLipsyncReleaseLoop();

    if (!lipsyncApi) {
      console.error('[lipsync] Lipsync API not available - window.Live2DVisemeLipSync is undefined');
      emitLipsyncTelemetry('sync.unavailable', {
        reason: 'missing_lipsync_api',
        has_lipsync_api: false,
        has_model: !!live2dModel,
        has_audio_element: !!audioElement
      });
      return false;
    }

    if (!live2dModel) {
      console.error('[lipsync] Live2D model not available');
      emitLipsyncTelemetry('sync.unavailable', {
        reason: 'missing_live2d_model',
        has_lipsync_api: true,
        has_model: false,
        has_audio_element: !!audioElement
      });
      return false;
    }

    try {
      const modelProbe = probeModelMouthParams();
      emitRendererDebug('lipsync.model_param_probe', {
        request_id: activeVoiceRequestId,
        ...modelProbe
      });
      if (modelProbe.has_mouth_open_param === false || modelProbe.has_mouth_form_param === false) {
        emitLipsyncTelemetry('sync.unavailable', {
          reason: 'missing_mouth_params',
          has_model: modelProbe.has_model,
          has_audio_element: !!audioElement
        });
      }

      if (externalAudioContext) {
        audioContext = externalAudioContext;
      }

      // Initialize AudioContext if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[lipsync] AudioContext created', {
          sampleRate: audioContext.sampleRate,
          state: audioContext.state
        });
        emitLipsyncTelemetry('sync.audio_context_ready', {
          sample_rate: audioContext.sampleRate,
          has_audio_context: true,
          reason: String(audioContext.state || 'unknown')
        });
      }

      // Resume AudioContext if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('[lipsync] AudioContext resumed');
        emitLipsyncTelemetry('sync.audio_context_resumed', {
          sample_rate: audioContext.sampleRate,
          has_audio_context: true
        });
      }

      if (externalAnalyser) {
        lipsyncAudioSource = lipsyncMediaElementSource;
        lipsyncAnalyser = externalAnalyser;
        emitLipsyncTelemetry('sync.graph_ready', {
          has_audio_context: true,
          has_audio_source: !!lipsyncAudioSource,
          has_analyser: !!lipsyncAnalyser,
          source_label: sourceLabel
        });
      } else {
        if (!audioElement) {
          emitLipsyncTelemetry('sync.unavailable', {
            reason: 'missing_audio_element',
            source_label: sourceLabel
          });
          return false;
        }

        if (!lipsyncMediaElementSource || lipsyncMediaElement !== audioElement) {
          // One MediaElementSourceNode can only be bound once per media element.
          lipsyncMediaElementSource = audioContext.createMediaElementSource(audioElement);
          lipsyncMediaElement = audioElement;
        }

        if (!lipsyncMediaElementAnalyser) {
          lipsyncMediaElementAnalyser = audioContext.createAnalyser();
          lipsyncMediaElementAnalyser.fftSize = 2048;
          lipsyncMediaElementAnalyser.smoothingTimeConstant = 0.8;
          lipsyncMediaElementSource.connect(lipsyncMediaElementAnalyser);
          lipsyncMediaElementAnalyser.connect(audioContext.destination);
        }

        lipsyncAudioSource = lipsyncMediaElementSource;
        lipsyncAnalyser = lipsyncMediaElementAnalyser;
        console.log('[lipsync] Audio nodes connected', {
          fftSize: lipsyncAnalyser.fftSize,
          frequencyBinCount: lipsyncAnalyser.frequencyBinCount,
          smoothingTimeConstant: lipsyncAnalyser.smoothingTimeConstant
        });
        emitLipsyncTelemetry('sync.graph_ready', {
          has_audio_context: true,
          has_audio_source: !!lipsyncAudioSource,
          has_analyser: !!lipsyncAnalyser,
          fft_size: lipsyncAnalyser.fftSize,
          frequency_bin_count: lipsyncAnalyser.frequencyBinCount,
          source_label: sourceLabel
        });
      }

      // Initialize lipsync state
      lipsyncState = lipsyncApi.createRuntimeState();
      syncLipsyncStateToDefaultMouthBasePose();
      console.log('[lipsync] Runtime state created', { state: lipsyncState });
      emitLipsyncTelemetry('sync.runtime_ready', { has_state: !!lipsyncState });
      if (bindLipsyncModelHook()) {
        lipsyncApplyMode = 'before_model_update';
      } else if (bindLipsyncTickerHook()) {
        lipsyncApplyMode = 'ticker';
      } else {
        lipsyncApplyMode = 'raf_direct';
      }
      emitRendererDebug('lipsync.apply_mode', {
        request_id: activeVoiceRequestId,
        mode: lipsyncApplyMode
      });

      const frequencyData = new Uint8Array(lipsyncAnalyser.frequencyBinCount);
      let frameCount = 0;

      // Animation loop
      function updateLipsync() {
        if (!lipsyncState || !live2dModel) {
          console.log('[lipsync] updateLipsync stopped - missing state or model');
          emitLipsyncTelemetry('sync.loop_stopped', {
            reason: 'missing_state_or_model',
            has_state: !!lipsyncState,
            has_model: !!live2dModel
          });
          stopLipsync('missing_state_or_model');
          return;
        }
        if (!lipsyncAnalyser || !audioContext) {
          console.log('[lipsync] updateLipsync stopped - missing analyser or context');
          emitLipsyncTelemetry('sync.loop_stopped', {
            reason: 'missing_analyser_or_context',
            has_analyser: !!lipsyncAnalyser,
            has_audio_context: !!audioContext
          });
          stopLipsync('missing_analyser_or_context');
          return;
        }

        lipsyncAnalyser.getByteFrequencyData(frequencyData);
        const voiceEnergy = estimateVoiceEnergy(frequencyData);
        const speaking = speakingResolver
          ? Boolean(speakingResolver())
          : !(audioElement?.paused || audioElement?.ended);
        const paused = audioElement ? !!audioElement.paused : !speaking;
        const ended = audioElement ? !!audioElement.ended : false;
        const readyState = audioElement ? Number(audioElement.readyState) : null;
        const basePose = getDefaultMouthBasePose();
        const frame = lipsyncApi.resolveVisemeFrame({
          frequencyBuffer: frequencyData,
          sampleRate: audioContext.sampleRate,
          voiceEnergy,
          speaking,
          fallbackOpen: basePose.mouthOpen,
          fallbackForm: basePose.mouthForm,
          state: lipsyncState
        }) || {};
        const rawMouthOpen = clamp(Number(frame.mouthOpen) || 0, 0, 1);
        const rawMouthForm = clamp(Number(frame.mouthForm) || 0, -1, 1);
        const enhanced = enhanceMouthParams({
          mouthOpen: rawMouthOpen,
          mouthForm: rawMouthForm,
          voiceEnergy,
          speaking
        });
        const consonantOverlay = frame.consonantOverlay && typeof frame.consonantOverlay === 'object'
          ? frame.consonantOverlay
          : null;
        const mouthOpen = clamp(
          enhanced.mouthOpen + (Number(consonantOverlay?.mouthOpenDelta) || 0),
          0,
          1
        );
        const stabilizedMouthOpen = applyMouthOpenDeadzone({
          mouthOpen,
          speaking
        });
        const mouthForm = clamp(
          enhanced.mouthForm + (Number(consonantOverlay?.mouthFormDelta) || 0),
          -1,
          1
        );
        lipsyncTargetMouthOpen = stabilizedMouthOpen;
        lipsyncTargetMouthForm = mouthForm;
        lipsyncSpeakingActive = speaking;
        setSpeechPresenterFrame({
          speaking,
          energy: Number(frame.features?.voiceEnergy) || voiceEnergy,
          mouthOpen: stabilizedMouthOpen,
          mouthForm,
          confidence: Number(frame.confidence) || 0,
          visemeWeights: frame.weights || {}
        });

        const waveformCaptureConfig = getWaveformCaptureRuntimeConfig();
        const captureEveryFrame = waveformCaptureConfig.enabled && waveformCaptureConfig.captureEveryFrame;

        // Log every 30 frames (roughly once per second at 60fps) unless full waveform capture is enabled.
        if (captureEveryFrame || frameCount % 30 === 0) {
          console.log('[lipsync] frame update', {
            frameCount,
            features: { energy: (Number(frame.features?.voiceEnergy) || voiceEnergy).toFixed(3) },
            weights: {
              a: (Number(frame.weights?.a) || 0).toFixed(2),
              i: (Number(frame.weights?.i) || 0).toFixed(2),
              u: (Number(frame.weights?.u) || 0).toFixed(2)
            },
            frame: {
              rawOpenY: rawMouthOpen.toFixed(3),
              rawForm: rawMouthForm.toFixed(3),
              openY: stabilizedMouthOpen.toFixed(3),
              form: mouthForm.toFixed(3)
            },
            transient: consonantOverlay
              ? {
                kind: consonantOverlay.kind,
                strength: (Number(consonantOverlay.strength) || 0).toFixed(2),
                openDelta: (Number(consonantOverlay.mouthOpenDelta) || 0).toFixed(3),
                formDelta: (Number(consonantOverlay.mouthFormDelta) || 0).toFixed(3)
              }
              : null
          });
          emitLipsyncTelemetry('frame.sample', {
            frame: frameCount,
            voice_energy: Number(frame.features?.voiceEnergy) || voiceEnergy,
            mouth_open: stabilizedMouthOpen,
            mouth_form: mouthForm,
            confidence: Number(frame.confidence) || 0
          });
          emitRendererDebug('lipsync.frame_sample', {
            request_id: activeVoiceRequestId,
            frame: frameCount,
            speaking,
            voice_energy: Number(frame.features?.voiceEnergy) || voiceEnergy,
            raw_mouth_open: rawMouthOpen,
            raw_mouth_form: rawMouthForm,
            mouth_open: stabilizedMouthOpen,
            mouth_form: mouthForm,
            confidence: Number(frame.confidence) || 0,
            apply_mode: lipsyncApplyMode,
            paused,
            ended,
            ready_state: readyState
          });
          emitRendererDebug('mouth.frame_sample', {
            request_id: activeVoiceRequestId,
            frame: frameCount,
            speaking,
            voice_energy: Number(frame.features?.voiceEnergy) || voiceEnergy,
            raw_mouth_open: rawMouthOpen,
            raw_mouth_form: rawMouthForm,
            mouth_open: stabilizedMouthOpen,
            mouth_form: mouthForm,
            confidence: Number(frame.confidence) || 0
          });
          if (speaking && voiceEnergy < 0.005) {
            emitRendererDebug('lipsync.frame_low_energy', {
              request_id: activeVoiceRequestId,
              frame: frameCount,
              voice_energy: voiceEnergy,
              paused,
              ended,
              ready_state: readyState
            });
          }
        }
        frameCount++;

        // If hooks are unavailable, fallback to direct RAF application.
        if (lipsyncApplyMode === 'raf_direct') {
          applyLipsyncValuesToModel({ source: 'raf_direct' });
        }
        try {
          if ((captureEveryFrame && waveformCaptureConfig.includeApplied) || frameCount % 60 === 0) {
            let appliedOpen = null;
            let appliedForm = null;
            try {
              const coreModel = live2dModel.internalModel.coreModel;
              appliedOpen = Number(coreModel.getParameterValueById?.('ParamMouthOpenY'));
              appliedForm = Number(coreModel.getParameterValueById?.('ParamMouthForm'));
            } catch {
              // ignore readback failures
            }
            emitRendererDebug('lipsync.frame_applied', {
              request_id: activeVoiceRequestId,
              frame: frameCount,
              target_mouth_open: mouthOpen,
              target_mouth_form: mouthForm,
              apply_mode: lipsyncApplyMode,
              applied_mouth_open: Number.isFinite(appliedOpen) ? appliedOpen : null,
              applied_mouth_form: Number.isFinite(appliedForm) ? appliedForm : null
            });
          }
        } catch {
          // ignore readback failures
        }

        lipsyncAnimationFrame = requestAnimationFrame(updateLipsync);
      }

      updateLipsync();
      console.log('[lipsync] Animation loop started');
      emitLipsyncTelemetry('sync.loop_started', {
        has_audio_context: !!audioContext,
        has_state: !!lipsyncState
      });
      return true;
    } catch (err) {
      console.error('[lipsync] Failed to start lipsync:', err);
      emitLipsyncTelemetry('sync.failed', {
        error: err?.message || String(err || 'unknown error'),
        has_audio_context: !!audioContext,
        has_audio_source: !!lipsyncAudioSource,
        has_analyser: !!lipsyncAnalyser
      });
      stopLipsync('start_failed', {
        error: err?.message || String(err || 'unknown error')
      });
      return false;
    }
  }

  function coerceAudioBytes(rawValue) {
    if (!rawValue) {
      return null;
    }
    if (rawValue instanceof Uint8Array) {
      return rawValue;
    }
    if (rawValue instanceof ArrayBuffer) {
      return new Uint8Array(rawValue);
    }
    if (ArrayBuffer.isView(rawValue)) {
      return new Uint8Array(rawValue.buffer, rawValue.byteOffset, rawValue.byteLength);
    }
    if (Array.isArray(rawValue)) {
      return Uint8Array.from(rawValue);
    }
    if (typeof rawValue === 'object') {
      if (Array.isArray(rawValue.data)) {
        return Uint8Array.from(rawValue.data);
      }
      if (Array.isArray(rawValue.bytes)) {
        return Uint8Array.from(rawValue.bytes);
      }
      if (rawValue.buffer && Number.isFinite(Number(rawValue.byteLength))) {
        const offset = Number(rawValue.byteOffset) || 0;
        const length = Number(rawValue.byteLength);
        try {
          return new Uint8Array(rawValue.buffer, offset, length);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function decodeVoiceMemoryPayload({ audioBytes = null, audioBase64 = null } = {}) {
    const binary = coerceAudioBytes(audioBytes);
    if (binary && binary.byteLength > 0) {
      return {
        bytes: binary,
        source: 'audio_bytes'
      };
    }
    const base64 = String(audioBase64 || '').trim();
    if (!base64) {
      return {
        bytes: null,
        source: 'missing'
      };
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return {
      bytes,
      source: 'audio_base64'
    };
  }

  async function playVoiceFromRemote({
    audioUrl = null,
    mimeType = 'audio/ogg',
    requestId = null,
    request_id = null,
    outputDelayMs = null
  } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
    const playbackDelayMs = resolveVoiceOutputDelayMs(outputDelayMs);
    const normalizedAudioUrl = String(audioUrl || '').trim();
    let playbackErrorReported = false;
    let audioUrlHost = null;
    try {
      audioUrlHost = new URL(normalizedAudioUrl).host || null;
    } catch {
      audioUrlHost = null;
    }
    emitRendererDebug('voice_remote.playback_enter', {
      request_id: nextRequestId,
      mime_type: String(mimeType || 'audio/ogg'),
      output_delay_ms: playbackDelayMs,
      audio_url_host: audioUrlHost
    });
    emitLipsyncTelemetry('playback.requested', {
      request_id: nextRequestId,
      bytes: 0,
      base64_chars: 0,
      mime_type: String(mimeType || 'audio/ogg'),
      has_lipsync_api: !!lipsyncApi,
      has_model: !!live2dModel
    });
    if (!normalizedAudioUrl) {
      emitLipsyncTelemetry('playback.invalid_payload', {
        request_id: nextRequestId,
        reason: 'missing_audio_remote_url'
      });
      throw createRpcError(-32602, 'audioUrl is required for remote voice playback');
    }

    if (activeVoiceRequestId && activeVoiceRequestId !== nextRequestId) {
      emitLipsyncTelemetry('playback.interrupted', {
        request_id: activeVoiceRequestId,
        reason: 'superseded_by_new_request'
      });
    }
    interruptRealtimeVoicePlayer('superseded_by_non_streaming_playback');
    stopLipsync('superseded_before_new_playback', {
      next_request_id: nextRequestId
    });
    activeVoiceRequestId = nextRequestId;
    try {
      try {
        systemAudio.pause();
      } catch {
        // ignore pause errors
      }
      systemAudio.currentTime = 0;

      releaseCurrentVoiceObjectUrl();
      currentVoiceObjectUrl = null;
      try {
        systemAudio.crossOrigin = 'anonymous';
      } catch {
        // ignore crossOrigin set failures
      }
      systemAudio.src = normalizedAudioUrl;
      systemAudio.muted = false;
      systemAudio.volume = 1;
      systemAudio.playbackRate = 1;

      emitLipsyncTelemetry('playback.source_ready', {
        request_id: nextRequestId,
        mime_type: String(mimeType || 'audio/ogg'),
        has_audio_element: true
      });
      emitRendererDebug('voice_remote.source_ready', {
        request_id: nextRequestId,
        audio_url_host: audioUrlHost,
        ...snapshotSystemAudioState()
      });

      // Start lipsync asynchronously so remote playback is never blocked by lipsync init.
      void primeLipsync(systemAudio).then((lipsyncStarted) => {
        if (!lipsyncStarted) {
          emitLipsyncTelemetry('playback.lipsync_inactive', {
            request_id: nextRequestId,
            reason: 'start_lipsync_returned_false',
            has_lipsync_api: !!lipsyncApi,
            has_model: !!live2dModel
          });
          emitRendererDebug('voice_remote.lipsync_inactive', {
            request_id: nextRequestId,
            reason: 'start_lipsync_returned_false'
          });
        } else {
          emitRendererDebug('voice_remote.lipsync_started', {
            request_id: nextRequestId
          });
        }
      }).catch((err) => {
        emitLipsyncTelemetry('playback.lipsync_inactive', {
          request_id: nextRequestId,
          reason: 'start_lipsync_rejected',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_remote.lipsync_failed', {
          request_id: nextRequestId,
          reason: 'start_lipsync_rejected',
          error: err?.message || String(err || 'unknown error')
        });
      });

      try {
        if (playbackDelayMs > 0) {
          emitRendererDebug('voice_remote.play_delay_wait', {
            request_id: nextRequestId,
            output_delay_ms: playbackDelayMs
          });
          await wait(playbackDelayMs);
          if (activeVoiceRequestId !== nextRequestId) {
            throw new Error('voice playback superseded during output delay');
          }
        }
        emitRendererDebug('voice_remote.play_attempt', {
          request_id: nextRequestId,
          output_delay_ms: playbackDelayMs,
          ...snapshotSystemAudioState()
        });
        await systemAudio.play();
        emitLipsyncTelemetry('playback.started', {
          request_id: nextRequestId,
          has_audio_element: true
        });
        emitRendererDebug('voice_remote.playback_started', {
          request_id: nextRequestId,
          ...snapshotSystemAudioState()
        });
      } catch (err) {
        playbackErrorReported = true;
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'audio_play_rejected',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_remote.play_rejected', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error'),
          ...snapshotSystemAudioState()
        });
        stopLipsync('audio_play_rejected', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error')
        });
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        throw err;
      }

      const handleEnded = () => {
        emitLipsyncTelemetry('playback.ended', {
          request_id: nextRequestId,
          reason: 'audio_ended'
        });
        stopLipsync('audio_ended', { request_id: nextRequestId });
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        systemAudio.removeEventListener('ended', handleEnded);
        systemAudio.removeEventListener('error', handleError);
      };
      const handleError = () => {
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'audio_element_error'
        });
        stopLipsync('audio_element_error', { request_id: nextRequestId });
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        systemAudio.removeEventListener('ended', handleEnded);
        systemAudio.removeEventListener('error', handleError);
      };
      systemAudio.addEventListener('ended', handleEnded);
      systemAudio.addEventListener('error', handleError);
    } catch (err) {
      if (!playbackErrorReported) {
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'playback_pipeline_failed',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_remote.playback_failed', {
          request_id: nextRequestId,
          reason: 'playback_pipeline_failed',
          error: err?.message || String(err || 'unknown error')
        });
        stopLipsync('playback_pipeline_failed', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error')
        });
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
      }
      throw err;
    }
  }

  async function playVoiceFromMemory({
    audioBytes = null,
    audioBase64 = null,
    mimeType = 'audio/ogg',
    requestId = null,
    request_id = null,
    outputDelayMs = null
  } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
    const playbackDelayMs = resolveVoiceOutputDelayMs(outputDelayMs);
    let objectUrl = null;
    let playbackErrorReported = false;
    const coarseBytes = coerceAudioBytes(audioBytes);
    emitRendererDebug('voice_memory.playback_enter', {
      request_id: nextRequestId,
      mime_type: String(mimeType || 'audio/ogg'),
      output_delay_ms: playbackDelayMs,
      bytes: Number(coarseBytes?.byteLength) || 0,
      base64_chars: Number(audioBase64?.length) || 0
    });
    console.log('[lipsync] playVoiceFromMemory called', {
      hasAudioBytes: !!coarseBytes,
      bytes: Number(coarseBytes?.byteLength) || 0,
      hasBase64: !!audioBase64,
      base64Length: audioBase64?.length,
      mimeType,
      requestId: nextRequestId,
      hasLipsyncApi: !!lipsyncApi,
      hasModel: !!live2dModel
    });
    emitLipsyncTelemetry('playback.requested', {
      request_id: nextRequestId,
      bytes: Number(coarseBytes?.byteLength) || 0,
      base64_chars: Number(audioBase64?.length) || 0,
      mime_type: String(mimeType || 'audio/ogg'),
      has_lipsync_api: !!lipsyncApi,
      has_model: !!live2dModel
    });

    const decodedPayload = decodeVoiceMemoryPayload({
      audioBytes,
      audioBase64
    });
    const bytes = decodedPayload.bytes;
    if (!bytes || bytes.byteLength === 0) {
      emitLipsyncTelemetry('playback.invalid_payload', {
        request_id: nextRequestId,
        reason: 'missing_audio_memory_payload'
      });
      throw createRpcError(-32602, 'audio payload is required (audioBytes or audioBase64)');
    }

    // Stop any existing lipsync
    if (activeVoiceRequestId && activeVoiceRequestId !== nextRequestId) {
      emitLipsyncTelemetry('playback.interrupted', {
        request_id: activeVoiceRequestId,
        reason: 'superseded_by_new_request'
      });
    }
    interruptRealtimeVoicePlayer('superseded_by_non_streaming_playback');
    stopLipsync('superseded_before_new_playback', {
      next_request_id: nextRequestId
    });
    activeVoiceRequestId = nextRequestId;
    try {
      try {
        systemAudio.pause();
      } catch {
        // ignore pause errors
      }
      systemAudio.currentTime = 0;

      const len = bytes.byteLength;

      console.log('[lipsync] Audio decoded', {
        source: decodedPayload.source,
        binaryLength: len,
        bytesLength: bytes.length
      });
      emitRendererDebug('voice_memory.decoded', {
        request_id: nextRequestId,
        source: decodedPayload.source,
        bytes: len
      });
      emitLipsyncTelemetry('playback.decoded', {
        request_id: nextRequestId,
        binary_length: len,
        bytes: bytes.length,
        mime_type: String(mimeType || 'audio/ogg')
      });

      releaseCurrentVoiceObjectUrl();
      const blob = new Blob([bytes], { type: String(mimeType || 'audio/ogg') });
      objectUrl = URL.createObjectURL(blob);
      currentVoiceObjectUrl = objectUrl;

      systemAudio.src = objectUrl;
      systemAudio.muted = false;
      systemAudio.volume = 1;
      systemAudio.playbackRate = 1;

      console.log('[lipsync] Audio source set, starting lipsync');
      emitLipsyncTelemetry('playback.source_ready', {
        request_id: nextRequestId,
        mime_type: String(mimeType || 'audio/ogg'),
        has_audio_element: true
      });
      emitRendererDebug('voice_memory.source_ready', {
        request_id: nextRequestId,
        ...snapshotSystemAudioState()
      });

      // Start lipsync asynchronously so audio playback is never blocked by lipsync init.
      void primeLipsync(systemAudio).then((lipsyncStarted) => {
        if (!lipsyncStarted) {
          emitLipsyncTelemetry('playback.lipsync_inactive', {
            request_id: nextRequestId,
            reason: 'start_lipsync_returned_false',
            has_lipsync_api: !!lipsyncApi,
            has_model: !!live2dModel
          });
          emitRendererDebug('voice_memory.lipsync_inactive', {
            request_id: nextRequestId,
            reason: 'start_lipsync_returned_false'
          });
        } else {
          emitRendererDebug('voice_memory.lipsync_started', {
            request_id: nextRequestId
          });
        }
      }).catch((err) => {
        emitLipsyncTelemetry('playback.lipsync_inactive', {
          request_id: nextRequestId,
          reason: 'start_lipsync_rejected',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_memory.lipsync_failed', {
          request_id: nextRequestId,
          reason: 'start_lipsync_rejected',
          error: err?.message || String(err || 'unknown error')
        });
      });

      try {
        if (playbackDelayMs > 0) {
          emitRendererDebug('voice_memory.play_delay_wait', {
            request_id: nextRequestId,
            output_delay_ms: playbackDelayMs
          });
          await wait(playbackDelayMs);
          if (activeVoiceRequestId !== nextRequestId) {
            throw new Error('voice playback superseded during output delay');
          }
        }
        emitRendererDebug('voice_memory.play_attempt', {
          request_id: nextRequestId,
          output_delay_ms: playbackDelayMs,
          ...snapshotSystemAudioState()
        });
        await systemAudio.play();
        console.log('[lipsync] Audio playback started');
        emitLipsyncTelemetry('playback.started', {
          request_id: nextRequestId,
          has_audio_element: true
        });
        emitRendererDebug('voice_memory.playback_started', {
          request_id: nextRequestId,
          ...snapshotSystemAudioState()
        });
      } catch (err) {
        playbackErrorReported = true;
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'audio_play_rejected',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_memory.play_rejected', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error'),
          ...snapshotSystemAudioState()
        });
        stopLipsync('audio_play_rejected', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error')
        });
        if (currentVoiceObjectUrl === objectUrl) {
          releaseCurrentVoiceObjectUrl();
        }
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        throw err;
      }

      const handleEnded = () => {
        emitLipsyncTelemetry('playback.ended', {
          request_id: nextRequestId,
          reason: 'audio_ended'
        });
        stopLipsync('audio_ended', { request_id: nextRequestId });
        if (currentVoiceObjectUrl === objectUrl) {
          releaseCurrentVoiceObjectUrl();
        }
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        systemAudio.removeEventListener('ended', handleEnded);
        systemAudio.removeEventListener('error', handleError);
      };
      const handleError = () => {
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'audio_element_error'
        });
        stopLipsync('audio_element_error', { request_id: nextRequestId });
        if (currentVoiceObjectUrl === objectUrl) {
          releaseCurrentVoiceObjectUrl();
        }
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
        systemAudio.removeEventListener('ended', handleEnded);
        systemAudio.removeEventListener('error', handleError);
      };
      systemAudio.addEventListener('ended', handleEnded);
      systemAudio.addEventListener('error', handleError);
    } catch (err) {
      if (!playbackErrorReported) {
        emitLipsyncTelemetry('playback.error', {
          request_id: nextRequestId,
          reason: 'playback_pipeline_failed',
          error: err?.message || String(err || 'unknown error')
        });
        emitRendererDebug('voice_memory.playback_failed', {
          request_id: nextRequestId,
          reason: 'playback_pipeline_failed',
          error: err?.message || String(err || 'unknown error')
        });
        stopLipsync('playback_pipeline_failed', {
          request_id: nextRequestId,
          error: err?.message || String(err || 'unknown error')
        });
        if (currentVoiceObjectUrl === objectUrl) {
          releaseCurrentVoiceObjectUrl();
        }
        if (activeVoiceRequestId === nextRequestId) {
          activeVoiceRequestId = null;
        }
      }
      throw err;
    }
  }

  async function startRealtimeVoicePlayback({
    requestId = null,
    request_id = null,
    sampleRate = 24000,
    prebufferMs = 160,
    idleTimeoutMs = 8000,
    outputDelayMs = null
  } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
    if (!nextRequestId) {
      return;
    }
    const playbackDelayMs = resolveVoiceOutputDelayMs(outputDelayMs);

    emitRendererDebug('voice_stream.playback_enter', {
      request_id: nextRequestId,
      sample_rate: Number(sampleRate) || 24000,
      prebuffer_ms: Number(prebufferMs) || 160,
      output_delay_ms: playbackDelayMs,
      idle_timeout_ms: Number(idleTimeoutMs) || 8000
    });
    emitLipsyncTelemetry('playback.requested', {
      request_id: nextRequestId,
      bytes: 0,
      base64_chars: 0,
      mime_type: 'audio/pcm',
      has_lipsync_api: !!lipsyncApi,
      has_model: !!live2dModel
    });

    if (activeVoiceRequestId && activeVoiceRequestId !== nextRequestId) {
      emitLipsyncTelemetry('playback.interrupted', {
        request_id: activeVoiceRequestId,
        reason: 'superseded_by_new_request'
      });
    }

    interruptRealtimeVoicePlayer('superseded_by_new_stream');
    stopLipsync('superseded_before_new_playback', { next_request_id: nextRequestId });
    activeVoiceRequestId = nextRequestId;

    try {
      try {
        systemAudio.pause();
      } catch {
        // ignore pause errors
      }
      systemAudio.currentTime = 0;
      releaseCurrentVoiceObjectUrl();

      const player = ensureRealtimeVoicePlayer();
      if (!player) {
        throw new Error('RealtimeVoicePlayer is unavailable');
      }

      let realtimeLipsyncPrimePromise = null;
      const primeRealtimeLipsync = () => {
        if (realtimeLipsyncPrimePromise) {
          return realtimeLipsyncPrimePromise;
        }
        realtimeLipsyncPrimePromise = primeLipsync(null, {
          analyserNode: player.getAnalyserNode(),
          audioContextInstance: player.getAudioContext(),
          isSpeaking: () => player.isSpeaking(nextRequestId),
          sourceLabel: 'realtime_stream'
        }).then((lipsyncStarted) => {
          if (!lipsyncStarted) {
            emitLipsyncTelemetry('playback.lipsync_inactive', {
              request_id: nextRequestId,
              reason: 'start_lipsync_returned_false',
              has_lipsync_api: !!lipsyncApi,
              has_model: !!live2dModel
            });
            emitRendererDebug('voice_stream.lipsync_inactive', {
              request_id: nextRequestId,
              reason: 'start_lipsync_returned_false'
            });
          } else {
            emitRendererDebug('voice_stream.lipsync_started', {
              request_id: nextRequestId
            });
          }
          return lipsyncStarted;
        }).catch((err) => {
          emitLipsyncTelemetry('playback.lipsync_inactive', {
            request_id: nextRequestId,
            reason: 'start_lipsync_rejected',
            error: err?.message || String(err || 'unknown error')
          });
          emitRendererDebug('voice_stream.lipsync_failed', {
            request_id: nextRequestId,
            reason: 'start_lipsync_rejected',
            error: err?.message || String(err || 'unknown error')
          });
          throw err;
        });
        return realtimeLipsyncPrimePromise;
      };

      await player.startSession({
        requestId: nextRequestId,
        sampleRate,
        prebufferMs,
        outputDelayMs: playbackDelayMs,
        idleTimeoutMs,
        onFirstAudio: () => {
          void primeRealtimeLipsync().catch(() => {
            // Errors are already reported in primeRealtimeLipsync.
          });
          emitLipsyncTelemetry('playback.started', {
            request_id: nextRequestId,
            has_audio_element: false,
            source: 'realtime_stream'
          });
          emitRendererDebug('voice_stream.playback_started', {
            request_id: nextRequestId,
            output_delay_ms: playbackDelayMs
          });
        },
        onEnded: ({ reason }) => {
          emitLipsyncTelemetry('playback.ended', {
            request_id: nextRequestId,
            reason: String(reason || 'audio_ended')
          });
          stopLipsync('audio_ended', {
            request_id: nextRequestId,
            reason: String(reason || 'audio_ended')
          });
          if (activeVoiceRequestId === nextRequestId) {
            activeVoiceRequestId = null;
          }
        },
        onError: ({ code, error }) => {
          emitLipsyncTelemetry('playback.error', {
            request_id: nextRequestId,
            reason: String(code || 'realtime_stream_failed'),
            error: String(error || 'realtime stream failed')
          });
          emitRendererDebug('voice_stream.playback_failed', {
            request_id: nextRequestId,
            code: String(code || 'realtime_stream_failed'),
            error: String(error || 'realtime stream failed')
          });
          stopLipsync('audio_element_error', {
            request_id: nextRequestId,
            reason: String(code || 'realtime_stream_failed'),
            error: String(error || 'realtime stream failed')
          });
          if (activeVoiceRequestId === nextRequestId) {
            activeVoiceRequestId = null;
          }
        },
        onInterrupted: ({ reason }) => {
          emitLipsyncTelemetry('playback.interrupted', {
            request_id: nextRequestId,
            reason: String(reason || 'interrupted')
          });
          if (activeVoiceRequestId === nextRequestId) {
            activeVoiceRequestId = null;
          }
        }
      });

      void primeRealtimeLipsync().catch(() => {
        // Errors are already reported in primeRealtimeLipsync.
      });

      emitLipsyncTelemetry('playback.source_ready', {
        request_id: nextRequestId,
        mime_type: 'audio/pcm',
        has_audio_element: false
      });
    } catch (err) {
      emitLipsyncTelemetry('playback.error', {
        request_id: nextRequestId,
        reason: 'playback_pipeline_failed',
        error: err?.message || String(err || 'unknown error')
      });
      emitRendererDebug('voice_stream.playback_setup_failed', {
        request_id: nextRequestId,
        reason: 'playback_pipeline_failed',
        error: err?.message || String(err || 'unknown error')
      });
      stopLipsync('playback_pipeline_failed', {
        request_id: nextRequestId,
        error: err?.message || String(err || 'unknown error')
      });
      if (activeVoiceRequestId === nextRequestId) {
        activeVoiceRequestId = null;
      }
    }
  }

  function appendRealtimeVoiceChunk({ requestId = null, request_id = null, seq = 0, audioBase64 = '', audio_base64 = '' } = {}) {
    const normalizedRequestId = normalizeVoiceRequestId(requestId || request_id);
    const player = realtimeVoicePlayer;
    if (!player || !normalizedRequestId) {
      return;
    }
    const payloadBase64 = String(audioBase64 || audio_base64 || '');
    const accepted = player.appendChunk({
      requestId: normalizedRequestId,
      audioBase64: payloadBase64
    });
    if (!accepted) {
      emitRendererDebug('voice_stream.chunk_dropped', {
        request_id: normalizedRequestId,
        seq: Number(seq) || 0,
        reason: 'player_rejected'
      });
      return;
    }
    const chunkIndex = Number(seq) || 0;
    if (chunkIndex <= 3 || chunkIndex % 10 === 0) {
      emitRendererDebug('voice_stream.chunk', {
        request_id: normalizedRequestId,
        seq: chunkIndex,
        base64_chars: payloadBase64.length
      });
    }
  }

  function endRealtimeVoicePlayback({ requestId = null, request_id = null, reason = 'completed' } = {}) {
    const normalizedRequestId = normalizeVoiceRequestId(requestId || request_id);
    if (!realtimeVoicePlayer || !normalizedRequestId) {
      return;
    }
    emitRendererDebug('voice_stream.end_received', {
      request_id: normalizedRequestId,
      reason: String(reason || 'completed')
    });
    realtimeVoicePlayer.endSession({
      requestId: normalizedRequestId,
      reason: String(reason || 'completed')
    });
  }

  function failRealtimeVoicePlayback({ requestId = null, request_id = null, code = 'REALTIME_STREAM_FAILED', error = 'realtime stream failed' } = {}) {
    const normalizedRequestId = normalizeVoiceRequestId(requestId || request_id);
    if (!realtimeVoicePlayer || !normalizedRequestId) {
      return;
    }
    emitRendererDebug('voice_stream.error_received', {
      request_id: normalizedRequestId,
      code: String(code || 'REALTIME_STREAM_FAILED'),
      error: String(error || 'realtime stream failed')
    });
    realtimeVoicePlayer.failSession({
      requestId: normalizedRequestId,
      code: String(code || 'REALTIME_STREAM_FAILED'),
      error: String(error || 'realtime stream failed')
    });
  }

  function positionBubbleNearModelHead() {
    if (!bubbleLayerElement || !bubbleElement) {
      return;
    }

    const stageSize = getStageSize();
    const bubbleWidth = Math.max(120, bubbleElement.offsetWidth || 260);
    const bubbleHeight = Math.max(36, bubbleElement.offsetHeight || 84);
    const margin = 10;
    const presenterSnapshot = waveformPresenter?.getLastSnapshot?.() || null;

    if (presenterSnapshot?.waveformVisible && presenterSnapshot.geometry) {
      const geometry = presenterSnapshot.geometry;
      const topPoints = Array.isArray(geometry.topPoints) ? geometry.topPoints : [];
      const localMinTop = topPoints.length > 0
        ? Math.min(...topPoints.map((point) => Number(point.y) || 0))
        : Math.round((Number(geometry.height) || stageSize.height) * 0.3);
      const waveformLeft = (Number(geometry.originX) || 0);
      const waveformTop = (Number(geometry.originY) || 0) + localMinTop;
      const waveformCenterX = waveformLeft + (Number(geometry.width) || stageSize.width) * 0.5;
      const nextLeft = clamp(waveformCenterX - bubbleWidth / 2, margin, stageSize.width - bubbleWidth - margin);
      const nextTop = clamp(waveformTop - bubbleHeight - 22, margin, stageSize.height - bubbleHeight - margin);
      bubbleLayerElement.style.left = `${Math.round(nextLeft)}px`;
      bubbleLayerElement.style.top = `${Math.round(nextTop)}px`;
      return;
    }

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

    if (isMixableFaceParam(name)) {
      const overlay = {};
      if (name === 'ParamMouthForm') overlay.mouthForm = value;
      if (name === 'ParamEyeLSmile') overlay.eyeSmileL = value;
      if (name === 'ParamEyeRSmile') overlay.eyeSmileR = value;
      if (name === 'ParamCheek') overlay.cheek = value;
      setFaceBlendTarget(overlay);
      return { ok: true, mixed: true };
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

    const mixedFaceTarget = {};
    const directUpdates = [];

    for (const update of updates) {
      const name = String(update?.name || '').trim();
      const value = Number(update?.value);
      if (isMixableFaceParam(name) && Number.isFinite(value)) {
        if (name === 'ParamMouthForm') mixedFaceTarget.mouthForm = value;
        if (name === 'ParamEyeLSmile') mixedFaceTarget.eyeSmileL = value;
        if (name === 'ParamEyeRSmile') mixedFaceTarget.eyeSmileR = value;
        if (name === 'ParamCheek') mixedFaceTarget.cheek = value;
        continue;
      }
      directUpdates.push(update);
    }

    if (Object.keys(mixedFaceTarget).length > 0) {
      setFaceBlendTarget(mixedFaceTarget);
    }
    for (const update of directUpdates) {
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

    setFaceBlendTarget(mapExpressionNameToFaceBlendTarget(name), { replace: true });

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

    resetFaceBlendTarget();

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

  function resetModelMouthPoseRaw() {
    const basePose = getDefaultMouthBasePose();
    return applyCompositeFacePoseToModel({
      mouthOpen: basePose.mouthOpen,
      mouthForm: basePose.mouthForm,
      speaking: false
    });
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
          resetModelMouthPoseRaw();
        },
        maxQueueSize: Number(runtimeActionQueueConfig.maxQueueSize) || 120,
        overflowPolicy: runtimeActionQueueConfig.overflowPolicy || 'drop_oldest',
        idleAction,
        mutex: ensureActionExecutionMutex(),
        onTelemetry: (payload) => {
          applyPresenterActionTelemetry(payload);
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
          enabled: externalMouthOverrideState.enabled === true,
          values: normalizeMouthTunerValues(externalMouthOverrideState.values)
        },
        mouthTuner: {
          visible: document.body.classList.contains('mouth-tuner-visible'),
          open: mouthTunerState.open === true,
          enabled: mouthTunerState.enabled === true,
          values: normalizeMouthTunerValues(mouthTunerState.values)
        },
        waveformCapture: {
          enabled: getWaveformCaptureRuntimeConfig().enabled,
          captureEveryFrame: getWaveformCaptureRuntimeConfig().captureEveryFrame,
          includeApplied: getWaveformCaptureRuntimeConfig().includeApplied
        }
      },
      presenter: getPresenterState(),
      musicPlayback: getMusicPlaybackState()
    };
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
    ensureWaveformLayer();
    ensureWaveformPresenter();
    ensureAudioFrameBus();
    ensurePresenterTickerHook();
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
    if (waveformLayer) {
      pixiApp.stage.addChild(waveformLayer);
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
    resetModelExpressionRaw();
    resetModelMouthPoseRaw();
    bindPersistentMouthOverrideHook();
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
      syncWindowInteractivityFromPointer();
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
      setWindowInteractivity(true);
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
    const baseWidth = Math.max(
      1,
      Number(resizeModeBaseWindowSize?.width)
        || Number(state.windowState?.defaultWidth)
        || Number(state.windowState?.width)
        || window.innerWidth
        || 460
    );
    const baseHeight = Math.max(
      1,
      Number(resizeModeBaseWindowSize?.height)
        || Number(state.windowState?.defaultHeight)
        || Number(state.windowState?.height)
        || window.innerHeight
        || 620
    );
    return {
      baseWidth,
      baseHeight,
      aspectRatio: Number(resizeModeBaseWindowSize?.aspectRatio) || Number(state.windowState?.aspectRatio) || (baseWidth / baseHeight)
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
      } else if (method === 'presenter.mode.set') {
        result = setPresenterMode(params);
      } else if (method === 'presenter.state.get') {
        result = getPresenterState();
      } else if (method === 'desktop.music.play') {
        result = await playWorkspaceMusic(params);
      } else if (method === 'desktop.music.pause') {
        ensureRendererMusicPlayer().pause();
        syncMusicPlaybackState({ status: 'paused' });
        result = getMusicPlaybackState();
      } else if (method === 'desktop.music.resume') {
        try {
          await ensureRendererMusicPlayer().resume();
          syncMusicPlaybackState({ status: 'playing', error: null });
          result = getMusicPlaybackState();
        } catch (error) {
          syncMusicPlaybackState({
            status: 'error',
            error: { message: error?.message || String(error || 'music resume failed') }
          });
          throw createRpcError(-32005, error?.message || String(error || 'music resume failed'));
        }
      } else if (method === 'desktop.music.stop') {
        ensureRendererMusicPlayer().stop();
        ensureAudioFrameBus()?.setMusicFrame({
          playing: false,
          energy: 0,
          bandLevels: [],
          spectrum: [],
          timeDomainEnergy: 0
        });
        syncMusicPlaybackState({
          status: 'stopped',
          path: null,
          audioUrl: null,
          trackLabel: null,
          error: null
        });
        result = getMusicPlaybackState();
      } else if (method === 'desktop.music.state.get') {
        result = getMusicPlaybackState();
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
        queuePresenterAction(normalized.value, result?.action_id);
      } else if (method === 'server_event_forward') {
        const { name, data } = params || {};
        console.log('[Renderer] Received RPC invoke:', name);
        if (name === 'voice.playback.electron') {
          const audioUrl = normalizeLegacyVoiceAudioUrl(data?.audio_ref || data?.audioRef || '');
          if (!audioUrl) {
            throw createRpcError(-32602, 'voice.playback.electron requires audio_ref');
          }
          void playVoiceFromRemote({
            requestId: `legacy-${Date.now()}`,
            audioUrl,
            mimeType: String(data?.format || 'audio/ogg'),
            outputDelayMs: resolveVoiceOutputDelayMs()
          }).catch((err) => {
            console.error('[Renderer] legacy voice playback failed', err);
            emitRendererDebug('voice_legacy.failed', {
              error: err?.message || String(err || 'unknown error')
            });
          });
          result = { ok: true, handled: true, name };
        } else {
          result = { ok: true, ignored: true, name, data };
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
      bindSystemAudioDebugEvents();
      emitRendererDebug('bootstrap.start', {
        has_bridge: true,
        has_on_voice_play_memory: typeof bridge.onVoicePlayMemory === 'function',
        has_on_voice_play_remote: typeof bridge.onVoicePlayRemote === 'function',
        has_on_voice_stream_start: typeof bridge.onVoiceStreamStart === 'function',
        has_on_voice_stream_chunk: typeof bridge.onVoiceStreamChunk === 'function',
        has_on_voice_stream_end: typeof bridge.onVoiceStreamEnd === 'function',
        has_on_voice_stream_error: typeof bridge.onVoiceStreamError === 'function',
        has_send_lipsync_telemetry: typeof bridge.sendLipsyncTelemetry === 'function'
      });

      window.addEventListener('focus', () => {
        suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS);
      }, { passive: true });
      window.addEventListener('mousemove', (event) => {
        lastPointerPosition = {
          clientX: Number(event.clientX) || 0,
          clientY: Number(event.clientY) || 0
        };
        syncWindowInteractivityFromPointer(lastPointerPosition);
      }, { passive: true });
      window.addEventListener('mouseleave', () => {
        lastPointerPosition = null;
        syncWindowInteractivityFromPointer(null);
      }, { passive: true });
      window.addEventListener('resize', () => {
        syncWindowInteractivityFromPointer();
      }, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS);
        }
      });

      const runtimeConfig = await bridge.getRuntimeConfig();
      runtimeUiConfig = runtimeConfig.uiConfig || null;
      runtimeLive2dPresets = runtimeConfig.live2dPresets || null;
      initMouthTuner();
      initLayoutTuner();
      initDragZoneTuner();
      initChatPanel(runtimeUiConfig?.chat || {});
      await initPixi();
      await loadModel(runtimeConfig.modelRelativePath, runtimeConfig.modelName);
      ensureActionQueuePlayer();
      setPresenterMode(getConfiguredPresenterMode());

      bridge.onInvoke((payload) => {
        void handleInvoke(payload);
      });

      bridge.onWindowStateSync?.((payload) => {
        applyWindowState(payload);
      });

      bridge.onVoicePlayMemory?.((payload) => {
        const requestId = normalizeVoiceRequestId(payload?.requestId || payload?.request_id);
        const coarseBytes = coerceAudioBytes(payload?.audioBytes);
        emitRendererDebug('voice_memory.received', {
          request_id: requestId,
          mime_type: String(payload?.mimeType || payload?.mime_type || ''),
          bytes: Number(coarseBytes?.byteLength) || 0,
          base64_chars: Number(payload?.audioBase64?.length) || 0
        });
        void playVoiceFromMemory(payload).catch((err) => {
          console.error('[Renderer] voice memory playback failed', err);
          emitRendererDebug('voice_memory.failed', {
            request_id: requestId,
            error: err?.message || String(err || 'unknown error')
          });
        });
      });
      if (typeof bridge.onVoicePlayMemory !== 'function') {
        emitRendererDebug('voice_memory.listener_missing', {
          reason: 'bridge.onVoicePlayMemory is not a function'
        });
      } else {
        emitRendererDebug('voice_memory.listener_registered', { ok: true });
      }

      bridge.onVoicePlayRemote?.((payload) => {
        const requestId = normalizeVoiceRequestId(payload?.requestId || payload?.request_id);
        emitRendererDebug('voice_remote.received', {
          request_id: requestId,
          mime_type: String(payload?.mimeType || payload?.mime_type || ''),
          audio_url_host: (() => {
            try {
              return new URL(String(payload?.audioUrl || payload?.audio_url || '')).host || null;
            } catch {
              return null;
            }
          })()
        });
        void playVoiceFromRemote(payload).catch((err) => {
          console.error('[Renderer] voice remote playback failed', err);
          emitRendererDebug('voice_remote.failed', {
            request_id: requestId,
            error: err?.message || String(err || 'unknown error')
          });
        });
      });
      if (typeof bridge.onVoicePlayRemote !== 'function') {
        emitRendererDebug('voice_remote.listener_missing', {
          reason: 'bridge.onVoicePlayRemote is not a function'
        });
      } else {
        emitRendererDebug('voice_remote.listener_registered', { ok: true });
      }

      bridge.onVoiceStreamStart?.((payload) => {
        const requestId = normalizeVoiceRequestId(payload?.requestId || payload?.request_id);
        emitRendererDebug('voice_stream.start_received', {
          request_id: requestId,
          sample_rate: Number(payload?.sampleRate) || 24000,
          prebuffer_ms: Number(payload?.prebufferMs) || 160,
          idle_timeout_ms: Number(payload?.idleTimeoutMs) || 8000
        });
        void startRealtimeVoicePlayback(payload);
      });
      if (typeof bridge.onVoiceStreamStart !== 'function') {
        emitRendererDebug('voice_stream_start.listener_missing', {
          reason: 'bridge.onVoiceStreamStart is not a function'
        });
      } else {
        emitRendererDebug('voice_stream_start.listener_registered', { ok: true });
      }

      bridge.onVoiceStreamChunk?.((payload) => {
        appendRealtimeVoiceChunk(payload);
      });
      if (typeof bridge.onVoiceStreamChunk !== 'function') {
        emitRendererDebug('voice_stream_chunk.listener_missing', {
          reason: 'bridge.onVoiceStreamChunk is not a function'
        });
      } else {
        emitRendererDebug('voice_stream_chunk.listener_registered', { ok: true });
      }

      bridge.onVoiceStreamEnd?.((payload) => {
        endRealtimeVoicePlayback(payload);
      });
      if (typeof bridge.onVoiceStreamEnd !== 'function') {
        emitRendererDebug('voice_stream_end.listener_missing', {
          reason: 'bridge.onVoiceStreamEnd is not a function'
        });
      } else {
        emitRendererDebug('voice_stream_end.listener_registered', { ok: true });
      }

      bridge.onVoiceStreamError?.((payload) => {
        failRealtimeVoicePlayback(payload);
      });
      if (typeof bridge.onVoiceStreamError !== 'function') {
        emitRendererDebug('voice_stream_error.listener_missing', {
          reason: 'bridge.onVoiceStreamError is not a function'
        });
      } else {
        emitRendererDebug('voice_stream_error.listener_registered', { ok: true });
      }

      bridge.notifyReady({ ok: true });
    } catch (err) {
      state.lastError = err?.message || String(err || 'renderer bootstrap failed');
      emitRendererDebug('bootstrap.failed', {
        error: state.lastError
      });
      bridge?.notifyError({ message: state.lastError });
    }
  }

  void main();
})();
