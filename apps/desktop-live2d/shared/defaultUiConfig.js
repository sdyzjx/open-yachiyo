(function initDesktopLive2dDefaults(globalScope) {
  const DEFAULT_LAYOUT_CONFIG = Object.freeze({
    // How much of the window width/height the model is allowed to occupy.
    // Larger values reduce blank space and make the avatar fill more of the window.
    targetWidthRatio: 0.94,
    targetHeightRatio: 0.985,

    // Anchor point inside the window. These replace the older derived alignment
    // rules with a simpler "anchor + offset" model.
    anchorXRatio: 0.5,
    anchorYRatio: 1,

    // Direct pixel offsets from the anchor point. offsetY is now the simplest
    // way to nudge the model up or down inside the window.
    offsetX: 0,
    offsetY: 95,

    // Safety margins kept inside the window after layout.
    // Larger values intentionally leave more empty space around the model.
    marginX: 2,
    marginY: 0,

    // When the model is larger than the available viewport, keep only part of it
    // visible instead of force-centering it. Smaller values loosen the safety clamp
    // and make offsetX/offsetY remain effective for oversized poses.
    minVisibleRatioX: 0.2,
    minVisibleRatioY: 0.2,

    // Which point inside the model bounds is treated as the anchor.
    // With pivotYRatio at 1, the model uses its bottom edge as the vertical anchor,
    // which keeps the feet aligned to the window bottom more predictably.
    pivotXRatio: 0.5,
    pivotYRatio: 1,

    // Final multiplier applied on top of the fit scale.
    // This is the direct "make the avatar bigger/smaller" knob.
    scaleMultiplier: 1.25,

    // Hard clamps for auto-fit and resize mode.
    minScale: 0.04,
    maxScale: 2,

    // Resize mode can either preserve the original fitted scale/position logic
    // or allow free re-fit per window change. Both are kept locked for stability.
    lockScaleOnResize: true,
    lockPositionOnResize: true
  });

  const DEFAULT_UI_CONFIG = Object.freeze({
    window: Object.freeze({
      // Default avatar window size before user overrides and persisted state.
      width: 320,
      height: 500,

      // Allowed runtime resize bounds for the avatar window.
      minWidth: 180,
      minHeight: 260,
      maxWidth: 900,
      maxHeight: 1400,

      // Whether hiding chat should shrink the avatar window into a compact profile.
      compactWhenChatHidden: false,
      compactWidth: 260,
      compactHeight: 500,
      placement: Object.freeze({
        // Initial screen placement for first launch before persisted state exists.
        anchor: 'bottom-right',
        marginRight: 18,
        marginBottom: 18
      })
    }),
    render: Object.freeze({
      // Renderer quality knobs. Usually these are left alone unless debugging
      // performance or visual sharpness.
      resolutionScale: 1,
      maxDevicePixelRatio: 2,
      antialias: false
    }),
    layout: DEFAULT_LAYOUT_CONFIG,
    chat: Object.freeze({
      panel: Object.freeze({
        // Desktop chat panel defaults.
        enabled: true,
        defaultVisible: false,
        width: 320,
        height: 220,
        maxMessages: 200,
        inputEnabled: true
      }),
      bubble: Object.freeze({
        // Whether assistant bubble messages should also be mirrored into chat history.
        mirrorToPanel: false,
        // Message truncation settings for bubble display
        truncate: Object.freeze({
          enabled: true,
          maxLength: 120,
          mode: 'smart', // 'simple' | 'smart' | 'disabled'
          suffix: '...',
          showHintForComplex: true // Show hint instead of truncating complex content
        })
      })
    }),
    actionQueue: Object.freeze({
      // Live2D action scheduling defaults.
      maxQueueSize: 120,
      overflowPolicy: 'drop_oldest',
      idleFallbackEnabled: true,
      idleAction: Object.freeze({
        type: 'motion',
        name: 'Idle',
        args: Object.freeze({
          group: 'Idle',
          index: 0
        })
      })
    })
  });

  const api = { DEFAULT_LAYOUT_CONFIG, DEFAULT_UI_CONFIG };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.DesktopLive2dDefaults = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
