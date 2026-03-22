(function initRendererSiriWaveDebugTools(globalScope) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundNumber(value, digits = 4) {
    return Number(toFiniteNumber(value, 0).toFixed(digits));
  }

  function summarizeCanvasElement(canvas) {
    return {
      cssWidth: roundNumber(parseFloat(canvas?.style?.width || 0), 2),
      cssHeight: roundNumber(parseFloat(canvas?.style?.height || 0), 2),
      pixelWidth: Math.max(0, Math.round(toFiniteNumber(canvas?.width, 0))),
      pixelHeight: Math.max(0, Math.round(toFiniteNumber(canvas?.height, 0)))
    };
  }

  function sampleCanvasMetrics(canvas, options = {}) {
    const summary = summarizeCanvasElement(canvas);
    const alphaThreshold = clamp(Math.round(toFiniteNumber(options.alphaThreshold, 16)), 0, 255);
    const stride = Math.max(1, Math.round(toFiniteNumber(options.stride, 4)));
    const result = {
      ...summary,
      available: false,
      alphaThreshold,
      stride,
      activeSampleCount: 0,
      activeRows: 0,
      verticalSpanPx: 0,
      maxAlpha: 0
    };

    if (!canvas || summary.pixelWidth < 1 || summary.pixelHeight < 1 || typeof canvas.getContext !== 'function') {
      return result;
    }

    let context = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      return result;
    }
    if (!context || typeof context.getImageData !== 'function') {
      return result;
    }

    let imageData = null;
    try {
      imageData = context.getImageData(0, 0, summary.pixelWidth, summary.pixelHeight);
    } catch {
      return result;
    }
    const data = imageData?.data;
    if (!data || data.length === 0) {
      return result;
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = -1;
    for (let y = 0; y < summary.pixelHeight; y += stride) {
      let rowActive = false;
      const rowOffset = y * summary.pixelWidth * 4;
      for (let x = 0; x < summary.pixelWidth; x += stride) {
        const alpha = data[rowOffset + x * 4 + 3] || 0;
        if (alpha > result.maxAlpha) {
          result.maxAlpha = alpha;
        }
        if (alpha < alphaThreshold) {
          continue;
        }
        rowActive = true;
        result.activeSampleCount += 1;
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
      if (rowActive) {
        result.activeRows += 1;
      }
    }

    result.available = true;
    result.verticalSpanPx = maxY >= minY ? maxY - minY + 1 : 0;
    return result;
  }

  function summarizeCurves(curves) {
    const summary = {
      renderedCurveCount: 0,
      supportLineCount: 0,
      clusterCount: 0,
      activeClusterCount: 0,
      maxClusterAmplitude: 0,
      maxFinalAmplitude: 0,
      maxPrevMaxY: 0
    };

    if (!Array.isArray(curves)) {
      return summary;
    }

    for (const curve of curves) {
      if (!curve || typeof curve !== 'object') {
        continue;
      }
      if (curve.definition?.supportLine) {
        summary.supportLineCount += 1;
        continue;
      }
      summary.renderedCurveCount += 1;
      const amplitudes = Array.isArray(curve.amplitudes) ? curve.amplitudes : [];
      const finalAmplitudes = Array.isArray(curve.finalAmplitudes) ? curve.finalAmplitudes : [];
      const clusterCount = Math.max(
        amplitudes.length,
        finalAmplitudes.length,
        Math.round(toFiniteNumber(curve.noOfCurves, 0))
      );
      summary.clusterCount += clusterCount;
      summary.maxPrevMaxY = Math.max(summary.maxPrevMaxY, toFiniteNumber(curve.prevMaxY, 0));

      for (const amplitude of amplitudes) {
        const value = toFiniteNumber(amplitude, 0);
        if (value > 0.001) {
          summary.activeClusterCount += 1;
        }
        summary.maxClusterAmplitude = Math.max(summary.maxClusterAmplitude, value);
      }
      for (const amplitude of finalAmplitudes) {
        summary.maxFinalAmplitude = Math.max(summary.maxFinalAmplitude, toFiniteNumber(amplitude, 0));
      }
    }

    summary.maxClusterAmplitude = roundNumber(summary.maxClusterAmplitude);
    summary.maxFinalAmplitude = roundNumber(summary.maxFinalAmplitude);
    summary.maxPrevMaxY = roundNumber(summary.maxPrevMaxY, 2);
    return summary;
  }

  function diagnoseWaveState({
    requestedMotion = null,
    curveSummary = null,
    canvasSample = null,
    run = false
  } = {}) {
    if (!run) {
      return 'stopped';
    }
    const requestedAmplitude = toFiniteNumber(requestedMotion?.amplitude, 0);
    if ((curveSummary?.clusterCount || 0) === 0) {
      return 'no_render_curves';
    }
    if (requestedAmplitude > 0.2 && (curveSummary?.activeClusterCount || 0) === 0) {
      return 'curve_amplitudes_not_ramped';
    }
    if (canvasSample?.available && canvasSample.activeSampleCount === 0) {
      return 'canvas_empty';
    }
    if (canvasSample?.available && requestedAmplitude > 0.2 && canvasSample.verticalSpanPx <= 3) {
      return 'canvas_nearly_flat';
    }
    return null;
  }

  function buildSiriWaveDebugState({
    wave = null,
    motion = null,
    layout = null,
    snapshot = null,
    generation = 0,
    recreateCount = 0,
    sampleCanvas = false
  } = {}) {
    if (!wave) {
      return {
        available: false,
        sourceKind: snapshot?.sourceKind || null,
        generation: Math.max(0, Math.round(toFiniteNumber(generation, 0))),
        recreateCount: Math.max(0, Math.round(toFiniteNumber(recreateCount, 0))),
        diagnosis: 'instance_unavailable'
      };
    }

    const canvas = wave.canvas || null;
    const curveSummary = summarizeCurves(wave.curves);
    const canvasSummary = summarizeCanvasElement(canvas);
    const canvasSample = sampleCanvas ? sampleCanvasMetrics(canvas) : null;
    const requestedMotion = motion
      ? {
          amplitude: roundNumber(motion.amplitude),
          speed: roundNumber(motion.speed),
          opacity: roundNumber(motion.opacity)
        }
      : null;

    return {
      available: true,
      sourceKind: snapshot?.sourceKind || null,
      generation: Math.max(0, Math.round(toFiniteNumber(generation, 0))),
      recreateCount: Math.max(0, Math.round(toFiniteNumber(recreateCount, 0))),
      diagnosis: diagnoseWaveState({
        requestedMotion,
        curveSummary,
        canvasSample,
        run: Boolean(wave.run)
      }),
      run: Boolean(wave.run),
      requested: requestedMotion,
      actual: {
        amplitude: roundNumber(wave.amplitude),
        speed: roundNumber(wave.speed)
      },
      target: {
        amplitude: roundNumber(
          wave.interpolation?.amplitude !== undefined ? wave.interpolation.amplitude : wave.amplitude
        ),
        speed: roundNumber(
          wave.interpolation?.speed !== undefined ? wave.interpolation.speed : wave.speed
        )
      },
      layout: layout
        ? {
            left: Math.round(toFiniteNumber(layout.left, 0)),
            top: Math.round(toFiniteNumber(layout.top, 0)),
            width: Math.round(toFiniteNumber(layout.width, 0)),
            height: Math.round(toFiniteNumber(layout.height, 0))
          }
        : null,
      canvas: {
        ...canvasSummary,
        ratio: roundNumber(wave.opt?.ratio, 3),
        heightMax: roundNumber(wave.heightMax, 2),
        sample: canvasSample
      },
      curves: curveSummary
    };
  }

  const api = {
    sampleCanvasMetrics,
    buildSiriWaveDebugState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererSiriWaveDebugTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
