(function bootstrap() {
  const bridge = window.desktopLive2dBridge;
  const interactionApi = window.Live2DInteraction || null;
  const actionMessageApi = window.Live2DActionMessage || null;
  const actionMutexApi = window.Live2DActionMutex || null;
  const actionQueueApi = window.Live2DActionQueuePlayer || null;
  const actionExecutorApi = window.Live2DActionExecutor || null;
  const lipsyncApi = window.Live2DVisemeLipSync || null;
  const state = {
    modelLoaded: false,
    modelName: null,
    bubbleVisible: false,
    chatPanelVisible: false,
    chatHistorySize: 0,
    lastError: null,
    layout: null
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
  let modelBaseBounds = null;
  let actionQueuePlayer = null;
  let actionExecutionMutex = null;
  let actionExecutor = null;
  let audioContext = null;
  let lipsyncState = null;
  let lipsyncAnimationFrame = null;
  let lipsyncAudioSource = null;
  let lipsyncAnalyser = null;
  let lipsyncCurrentMouthOpen = 0;
  let lipsyncCurrentMouthForm = 0;
  let lipsyncDetachModelHook = null;
  let lipsyncDetachTickerHook = null;
  let lipsyncApplyMode = 'raf_direct';
  let activeVoiceRequestId = null;
  let systemAudioDebugBound = false;
  let realtimeVoicePlayer = null;

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
  const LIPSYNC_OPEN_GAIN_MIN = 1.35;
  const LIPSYNC_OPEN_GAIN_MAX = 1.95;
  const LIPSYNC_FORM_GAIN_MIN = 1.2;
  const LIPSYNC_FORM_GAIN_MAX = 1.7;
  const LIPSYNC_OPEN_GAMMA = 0.78;
  const LIPSYNC_ACTIVE_ENERGY_MIN = 0.018;
  const LIPSYNC_MIN_OPEN_WHEN_SPEAKING = 0.12;

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
    const active = Boolean(speaking) && energy >= LIPSYNC_ACTIVE_ENERGY_MIN;
    const intensity = clamp((energy - LIPSYNC_ACTIVE_ENERGY_MIN) / 0.08, 0, 1);

    if (!active) {
      return {
        mouthOpen: rawOpen,
        mouthForm: rawForm
      };
    }

    const openGain = lerp(LIPSYNC_OPEN_GAIN_MIN, LIPSYNC_OPEN_GAIN_MAX, intensity);
    const formGain = lerp(LIPSYNC_FORM_GAIN_MIN, LIPSYNC_FORM_GAIN_MAX, intensity);
    const widenedOpen = Math.pow(rawOpen, LIPSYNC_OPEN_GAMMA) * openGain + Math.abs(rawForm) * 0.08 * intensity;
    const boostedOpen = Math.max(clamp(widenedOpen, 0, 1), LIPSYNC_MIN_OPEN_WHEN_SPEAKING);
    const boostedForm = clamp(rawForm * formGain, -1, 1);

    return {
      mouthOpen: boostedOpen,
      mouthForm: boostedForm
    };
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

  function applyLipsyncValuesToModel({ source = 'unknown' } = {}) {
    const coreModel = live2dModel?.internalModel?.coreModel;
    if (!coreModel) {
      return false;
    }
    const mouthOpen = clamp(Number(lipsyncCurrentMouthOpen) || 0, 0, 1);
    const mouthForm = clamp(Number(lipsyncCurrentMouthForm) || 0, -1, 1);
    try {
      if (typeof coreModel.addParameterValueById === 'function') {
        coreModel.addParameterValueById('ParamMouthOpenY', mouthOpen, 1);
        coreModel.addParameterValueById('ParamMouthForm', mouthForm, 1);
      } else {
        coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen);
        coreModel.setParameterValueById('ParamMouthForm', mouthForm);
      }
      return true;
    } catch (err) {
      emitLipsyncTelemetry('frame.apply_failed', {
        error: err?.message || String(err || 'unknown error'),
        mouth_open: mouthOpen,
        mouth_form: mouthForm,
        reason: `apply_${source}_failed`
      });
      return false;
    }
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
    detachLipsyncModelHook();
    detachLipsyncTickerHook();
    lipsyncState = null;
    lipsyncCurrentMouthOpen = 0;
    lipsyncCurrentMouthForm = 0;
    lipsyncApplyMode = 'raf_direct';

    // Reset mouth parameters to neutral
    if (live2dModel) {
      try {
        live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
        live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', 0);
        console.log('[lipsync] mouth parameters reset to neutral');
        emitLipsyncTelemetry('sync.reset_neutral', { has_model: true, mouth_open: 0, mouth_form: 0 });
      } catch (err) {
        console.warn('[lipsync] Failed to reset mouth parameters:', err);
        emitLipsyncTelemetry('sync.reset_failed', { has_model: true, error: err?.message || String(err || 'unknown error') });
      }
    }
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
        lipsyncAudioSource = null;
        lipsyncAnalyser = externalAnalyser;
        emitLipsyncTelemetry('sync.graph_ready', {
          has_audio_context: true,
          has_audio_source: false,
          has_analyser: !!lipsyncAnalyser,
          source_label: sourceLabel
        });
      } else if (!lipsyncAudioSource || !lipsyncAnalyser) {
        // MediaElementSource can only be created once for the same audio element.
        lipsyncAudioSource = audioContext.createMediaElementSource(audioElement);
        lipsyncAnalyser = audioContext.createAnalyser();
        lipsyncAnalyser.fftSize = 2048;
        lipsyncAnalyser.smoothingTimeConstant = 0.8;
        lipsyncAudioSource.connect(lipsyncAnalyser);
        lipsyncAnalyser.connect(audioContext.destination);
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
        const frame = lipsyncApi.resolveVisemeFrame({
          frequencyBuffer: frequencyData,
          sampleRate: audioContext.sampleRate,
          voiceEnergy,
          speaking,
          fallbackOpen: 0,
          fallbackForm: 0,
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
        const mouthOpen = enhanced.mouthOpen;
        const mouthForm = enhanced.mouthForm;
        lipsyncCurrentMouthOpen = mouthOpen;
        lipsyncCurrentMouthForm = mouthForm;

        // Log every 30 frames (roughly once per second at 60fps)
        if (frameCount % 30 === 0) {
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
              openY: mouthOpen.toFixed(3),
              form: mouthForm.toFixed(3)
            }
          });
          emitLipsyncTelemetry('frame.sample', {
            frame: frameCount,
            voice_energy: Number(frame.features?.voiceEnergy) || voiceEnergy,
            mouth_open: mouthOpen,
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
            mouth_open: mouthOpen,
            mouth_form: mouthForm,
            confidence: Number(frame.confidence) || 0,
            apply_mode: lipsyncApplyMode,
            paused,
            ended,
            ready_state: readyState
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
          if (frameCount % 60 === 0) {
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

  async function playVoiceFromRemote({ audioUrl = null, mimeType = 'audio/ogg', requestId = null, request_id = null } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
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
      void startLipsync(systemAudio).then((lipsyncStarted) => {
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
        emitRendererDebug('voice_remote.play_attempt', {
          request_id: nextRequestId,
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

  async function playVoiceFromMemory({ audioBytes = null, audioBase64 = null, mimeType = 'audio/ogg', requestId = null, request_id = null } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
    let objectUrl = null;
    let playbackErrorReported = false;
    const coarseBytes = coerceAudioBytes(audioBytes);
    emitRendererDebug('voice_memory.playback_enter', {
      request_id: nextRequestId,
      mime_type: String(mimeType || 'audio/ogg'),
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
      void startLipsync(systemAudio).then((lipsyncStarted) => {
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
        emitRendererDebug('voice_memory.play_attempt', {
          request_id: nextRequestId,
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
    idleTimeoutMs = 8000
  } = {}) {
    const nextRequestId = normalizeVoiceRequestId(requestId || request_id || `${Date.now()}-voice`);
    if (!nextRequestId) {
      return;
    }

    emitRendererDebug('voice_stream.playback_enter', {
      request_id: nextRequestId,
      sample_rate: Number(sampleRate) || 24000,
      prebuffer_ms: Number(prebufferMs) || 160,
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

      await player.startSession({
        requestId: nextRequestId,
        sampleRate,
        prebufferMs,
        idleTimeoutMs,
        onFirstAudio: () => {
          emitLipsyncTelemetry('playback.started', {
            request_id: nextRequestId,
            has_audio_element: false,
            source: 'realtime_stream'
          });
          emitRendererDebug('voice_stream.playback_started', {
            request_id: nextRequestId
          });

          void startLipsync(null, {
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
      layout: state.layout
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
        dragging: false
      };
      if (typeof targetElement.setPointerCapture === 'function') {
        targetElement.setPointerCapture(event.pointerId);
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
      bridge.sendWindowDrag({
        action: 'move',
        screenX: event.screenX,
        screenY: event.screenY
      });
      event.preventDefault();
    });

    const completeDrag = (event) => {
      if (!dragPointerState || event.pointerId !== dragPointerState.pointerId) {
        return;
      }
      bridge.sendWindowDrag({
        action: 'end',
        screenX: event.screenX,
        screenY: event.screenY
      });
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

    if (stableModelScale === null || !Number.isFinite(stableModelScale)) {
      stableModelScale = layout.scale;
    }
    const nextScale = lockScaleOnResize ? stableModelScale : layout.scale;
    if (!lockScaleOnResize) {
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

    let nextPositionX = layout.positionX;
    let nextPositionY = layout.positionY;
    if (lockPositionOnResize) {
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

    if (
      typeof live2dModel.scale?.set === 'function'
      && shouldUpdate2DTransform(live2dModel.scale?.x, live2dModel.scale?.y, nextScale, nextScale, 1e-5)
    ) {
      live2dModel.scale.set(nextScale);
    }
    if (
      typeof live2dModel.pivot?.set === 'function'
      && shouldUpdate2DTransform(live2dModel.pivot?.x, live2dModel.pivot?.y, layout.pivotX, layout.pivotY, 1e-5)
    ) {
      live2dModel.pivot.set(layout.pivotX, layout.pivotY);
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
      pivotX: layout.pivotX,
      pivotY: layout.pivotY,
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
        result = { ok: true, ignored: true, name, data };
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
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          suppressModelTap(MODEL_TAP_SUPPRESS_AFTER_FOCUS_MS);
        }
      });

      const runtimeConfig = await bridge.getRuntimeConfig();
      runtimeUiConfig = runtimeConfig.uiConfig || null;
      runtimeLive2dPresets = runtimeConfig.live2dPresets || null;
      initChatPanel(runtimeUiConfig?.chat || {});
      await initPixi();
      await loadModel(runtimeConfig.modelRelativePath, runtimeConfig.modelName);
      ensureActionQueuePlayer();

      bridge.onInvoke((payload) => {
        void handleInvoke(payload);
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
