(function bootstrap() {
  const bridge = window.desktopLive2dBridge;
  const interactionApi = window.Live2DInteraction || null;
  const actionMessageApi = window.Live2DActionMessage || null;
  const actionMutexApi = window.Live2DActionMutex || null;
  const actionQueueApi = window.Live2DActionQueuePlayer || null;
  const actionExecutorApi = window.Live2DActionExecutor || null;
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

  async function playVoiceFromBase64({ audioBase64, mimeType = 'audio/ogg' } = {}) {
    const base64 = String(audioBase64 || '').trim();
    if (!base64) {
      throw createRpcError(-32602, 'audioBase64 is required');
    }

    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    releaseCurrentVoiceObjectUrl();
    const blob = new Blob([bytes], { type: String(mimeType || 'audio/ogg') });
    const objectUrl = URL.createObjectURL(blob);
    currentVoiceObjectUrl = objectUrl;

    systemAudio.src = objectUrl;
    await systemAudio.play();

    const cleanup = () => {
      if (currentVoiceObjectUrl === objectUrl) {
        releaseCurrentVoiceObjectUrl();
      }
      systemAudio.removeEventListener('ended', cleanup);
      systemAudio.removeEventListener('error', cleanup);
    };
    systemAudio.addEventListener('ended', cleanup);
    systemAudio.addEventListener('error', cleanup);
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
        if (name === 'voice.play') {
          try {
            systemAudio.src = `file://${data.audioPath}`;
            systemAudio.play().catch(console.error);
            result = { ok: true };
          } catch (err) {
            throw createRpcError(-32000, 'play failed');
          }
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
      initChatPanel(runtimeUiConfig?.chat || {});
      await initPixi();
      await loadModel(runtimeConfig.modelRelativePath, runtimeConfig.modelName);
      ensureActionQueuePlayer();

      bridge.onInvoke((payload) => {
        void handleInvoke(payload);
      });

      bridge.onVoicePlayMemory?.((payload) => {
        void playVoiceFromBase64(payload).catch((err) => {
          console.error('[Renderer] voice memory playback failed', err);
        });
      });

      bridge.notifyReady({ ok: true });
    } catch (err) {
      state.lastError = err?.message || String(err || 'renderer bootstrap failed');
      bridge?.notifyError({ message: state.lastError });
    }
  }

  void main();
})();
