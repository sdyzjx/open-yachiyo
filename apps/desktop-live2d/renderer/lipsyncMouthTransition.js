(function initLive2dMouthTransition(globalScope) {
  const DEFAULT_CONFIG = Object.freeze({
    open: {
      attack: 0.56,
      release: 0.3,
      neutral: 0.16
    },
    form: {
      attack: 0.4,
      release: 0.24,
      neutral: 0.14
    },
    settle: {
      targetEpsilon: 0.008,
      valueEpsilon: 0.005
    }
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeMouthValueSet(input = {}) {
    return {
      mouthOpen: clamp(Number(input.mouthOpen) || 0, 0, 1),
      mouthForm: clamp(Number(input.mouthForm) || 0, -1, 1)
    };
  }

  function resolveChannelAlpha(channelConfig, current, target, speaking, settleConfig) {
    const safeCurrent = Number(current) || 0;
    const safeTarget = Number(target) || 0;
    const targetMagnitude = Math.abs(safeTarget);
    const currentMagnitude = Math.abs(safeCurrent);
    const safeChannelConfig = channelConfig || {};
    const safeSettleConfig = settleConfig || {};
    if (!speaking && targetMagnitude <= (Number(safeSettleConfig.targetEpsilon) || 0)) {
      return clamp(Number(safeChannelConfig.neutral) || 0, 0, 1);
    }
    if (targetMagnitude > currentMagnitude) {
      return clamp(Number(safeChannelConfig.attack) || 0, 0, 1);
    }
    return clamp(Number(safeChannelConfig.release) || 0, 0, 1);
  }

  function stepMouthTransition(input = {}) {
    const current = normalizeMouthValueSet(input.current);
    const target = normalizeMouthValueSet(input.target);
    const speaking = Boolean(input.speaking);
    const config = input.config || DEFAULT_CONFIG;
    const settleConfig = config.settle || DEFAULT_CONFIG.settle;
    const openAlpha = resolveChannelAlpha(config.open, current.mouthOpen, target.mouthOpen, speaking, settleConfig);
    const formAlpha = resolveChannelAlpha(config.form, current.mouthForm, target.mouthForm, speaking, settleConfig);
    return {
      mouthOpen: clamp(current.mouthOpen + (target.mouthOpen - current.mouthOpen) * openAlpha, 0, 1),
      mouthForm: clamp(current.mouthForm + (target.mouthForm - current.mouthForm) * formAlpha, -1, 1)
    };
  }

  function isMouthTransitionSettled(input = {}) {
    const current = normalizeMouthValueSet(input.current);
    const target = normalizeMouthValueSet(input.target);
    const settleConfig = input.config?.settle || DEFAULT_CONFIG.settle;
    const targetEpsilon = Math.max(0, Number(settleConfig.targetEpsilon) || 0);
    const valueEpsilon = Math.max(0, Number(settleConfig.valueEpsilon) || 0);
    return (
      Math.abs(target.mouthOpen) <= targetEpsilon
      && Math.abs(target.mouthForm) <= targetEpsilon
      && Math.abs(current.mouthOpen - target.mouthOpen) <= valueEpsilon
      && Math.abs(current.mouthForm - target.mouthForm) <= valueEpsilon
    );
  }

  const api = {
    DEFAULT_CONFIG,
    stepMouthTransition,
    isMouthTransitionSettled
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.Live2DMouthTransition = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
