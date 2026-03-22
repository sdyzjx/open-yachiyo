(function initSiriWaveBridge(globalScope) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const DEFAULT_CURVE_DEFINITION = Object.freeze([
    Object.freeze({
      color: '255,255,255',
      supportLine: true
    }),
    Object.freeze({
      color: '72, 184, 255'
    }),
    Object.freeze({
      color: '118, 150, 255'
    }),
    Object.freeze({
      color: '255, 105, 214'
    })
  ]);

  const DEFAULT_RANGES = Object.freeze({
    noOfCurves: Object.freeze([3, 5]),
    amplitude: Object.freeze([0.42, 1]),
    offset: Object.freeze([-2.4, 2.4]),
    width: Object.freeze([1, 2.2]),
    speed: Object.freeze([0.34, 0.62]),
    despawnTimeout: Object.freeze([1600, 2800])
  });

  function ensureArrayWithLength(value, length, fillValue = 0) {
    const next = Array.isArray(value) ? value : [];
    while (next.length < length) {
      next.push(fillValue);
    }
    return next;
  }

  function normalizeCurveVerse(value, index) {
    const parsed = toFiniteNumber(value, 0);
    if (Math.abs(parsed) >= 0.12) {
      return parsed;
    }
    return index % 2 === 0 ? 0.55 : -0.55;
  }

  function stabilizeSiriWaveInstance(wave, motion, snapshot) {
    if (!wave || !motion || !Array.isArray(wave.curves)) {
      return false;
    }

    const sourceKind = String(snapshot?.sourceKind || 'breath').trim().toLowerCase();
    if (sourceKind !== 'speech' && sourceKind !== 'music') {
      return false;
    }

    const requestedAmplitude = clamp(toFiniteNumber(motion.amplitude, 0), 0, 1);
    const requestedSpeed = clamp(toFiniteNumber(motion.speed, 0), 0, 1);
    if (requestedAmplitude < 0.18) {
      return false;
    }

    let changed = false;
    const nowMs = Date.now();
    const baseFinalAmplitude = clamp(0.48 + requestedAmplitude * 0.56, 0.54, 1);
    const baseLiveAmplitude = clamp(
      baseFinalAmplitude * (0.58 + requestedSpeed * 0.18),
      0.32,
      baseFinalAmplitude
    );
    const basePrevMaxY = Math.max(1.2, toFiniteNumber(wave.heightMax, 0) * requestedAmplitude * 0.18);

    for (const curve of wave.curves) {
      if (!curve || curve.definition?.supportLine) {
        continue;
      }

      if (
        typeof curve.spawn === 'function'
        && (
          toFiniteNumber(curve.noOfCurves, 0) < 1
          || !Array.isArray(curve.amplitudes)
          || curve.amplitudes.length === 0
          || !Array.isArray(curve.finalAmplitudes)
          || curve.finalAmplitudes.length === 0
        )
      ) {
        curve.spawn();
      }

      const count = Math.max(
        1,
        Math.round(toFiniteNumber(curve.noOfCurves, 0)),
        Array.isArray(curve.amplitudes) ? curve.amplitudes.length : 0,
        Array.isArray(curve.finalAmplitudes) ? curve.finalAmplitudes.length : 0
      );
      const amplitudes = ensureArrayWithLength(curve.amplitudes, count, 0);
      const finalAmplitudes = ensureArrayWithLength(curve.finalAmplitudes, count, baseFinalAmplitude);
      const despawnTimeouts = ensureArrayWithLength(curve.despawnTimeouts, count, 2200);
      const offsets = ensureArrayWithLength(curve.offsets, count, 0);
      const speeds = ensureArrayWithLength(curve.speeds, count, 0.48);
      const widths = ensureArrayWithLength(curve.widths, count, 1.35);
      const verses = ensureArrayWithLength(curve.verses, count, 0.55);
      const phases = ensureArrayWithLength(curve.phases, count, 0);

      let maxAmplitude = 0;
      for (let index = 0; index < count; index += 1) {
        maxAmplitude = Math.max(maxAmplitude, toFiniteNumber(amplitudes[index], 0));
      }
      const prevMaxY = toFiniteNumber(curve.prevMaxY, 0);
      if (maxAmplitude >= 0.02 && prevMaxY >= 0.5) {
        continue;
      }

      curve.noOfCurves = count;
      curve.spawnAt = Math.max(toFiniteNumber(curve.spawnAt, 0), nowMs);

      for (let index = 0; index < count; index += 1) {
        const seededFinalAmplitude = clamp(
          baseFinalAmplitude * (0.92 + (index % 3) * 0.06),
          0.52,
          1
        );
        const currentFinalAmplitude = toFiniteNumber(finalAmplitudes[index], 0);
        if (currentFinalAmplitude < seededFinalAmplitude) {
          finalAmplitudes[index] = seededFinalAmplitude;
          changed = true;
        }

        const currentAmplitude = toFiniteNumber(amplitudes[index], 0);
        const seededAmplitude = Math.min(
          toFiniteNumber(finalAmplitudes[index], seededFinalAmplitude),
          clamp(baseLiveAmplitude * (0.96 + (index % 2) * 0.06), 0.32, 1)
        );
        if (currentAmplitude < seededAmplitude) {
          amplitudes[index] = seededAmplitude;
          changed = true;
        }

        const currentDespawnTimeout = toFiniteNumber(despawnTimeouts[index], 0);
        if (currentDespawnTimeout < 2200) {
          despawnTimeouts[index] = 2200 + index * 180;
          changed = true;
        }

        const currentOffset = offsets[index];
        if (!Number.isFinite(Number(currentOffset))) {
          offsets[index] = count === 1 ? 0 : -1.4 + (index / (count - 1)) * 2.8;
          changed = true;
        }

        const currentSpeed = speeds[index];
        if (!Number.isFinite(Number(currentSpeed)) || Number(currentSpeed) <= 0) {
          speeds[index] = 0.38 + index * 0.05;
          changed = true;
        }

        const currentWidth = widths[index];
        if (!Number.isFinite(Number(currentWidth)) || Number(currentWidth) <= 0) {
          widths[index] = 1.24 + index * 0.16;
          changed = true;
        }

        const normalizedVerse = normalizeCurveVerse(verses[index], index);
        if (normalizedVerse !== verses[index]) {
          verses[index] = normalizedVerse;
          changed = true;
        }

        const phase = toFiniteNumber(phases[index], 0);
        if (phase !== phases[index]) {
          phases[index] = phase;
          changed = true;
        }
      }

      if (prevMaxY < basePrevMaxY) {
        curve.prevMaxY = basePrevMaxY;
        changed = true;
      }
    }

    return changed;
  }

  function resolveSiriWaveLayout(snapshot, stageSize = {}) {
    const stageWidth = Math.max(1, Math.round(toFiniteNumber(stageSize.width, 640)));
    const stageHeight = Math.max(1, Math.round(toFiniteNumber(stageSize.height, 640)));
    const geometry = snapshot?.geometry && typeof snapshot.geometry === 'object'
      ? snapshot.geometry
      : null;
    const width = geometry
      ? Math.max(180, Math.round(toFiniteNumber(geometry.width, stageWidth * 0.68)))
      : Math.max(180, Math.round(stageWidth * 0.68));
    const rawHeight = geometry
      ? Math.max(72, Math.round(toFiniteNumber(geometry.height, 72) * 2.2))
      : Math.max(72, Math.round(stageHeight * 0.18));
    const height = Math.min(Math.max(72, rawHeight), Math.max(96, stageHeight - 24));
    const left = geometry
      ? clamp(Math.round(toFiniteNumber(geometry.originX, 0)), 0, Math.max(0, stageWidth - width))
      : Math.max(0, Math.round((stageWidth - width) / 2));
    const centerY = geometry
      ? Math.round(toFiniteNumber(geometry.originY, 0) + toFiniteNumber(geometry.height, height / 2) / 2)
      : Math.round(stageHeight * 0.54);
    const top = clamp(Math.round(centerY - height / 2), 8, Math.max(8, stageHeight - height - 8));
    return {
      left,
      top,
      width,
      height
    };
  }

  function resolveSiriWaveMotion(snapshot) {
    const sourceKind = String(snapshot?.sourceKind || 'breath').trim().toLowerCase();
    const energy = clamp(toFiniteNumber(snapshot?.energy, 0), 0, 1);
    const actionScale = clamp(toFiniteNumber(snapshot?.actionScale, 1), 1, 1.8);
    const actionBoost = clamp((actionScale - 1) / 0.8, 0, 1);
    const waveformAlpha = clamp(toFiniteNumber(snapshot?.waveformAlpha, 0), 0, 1);

    if (sourceKind === 'breath') {
      return {
        amplitude: 0,
        speed: 0,
        opacity: waveformAlpha
      };
    }

    const shapedEnergy = Math.pow(energy, 0.72);
    const isMusic = sourceKind === 'music';
    const baseAmplitude = isMusic ? 0.44 : 0.56;
    const amplitudeRange = isMusic ? 0.72 : 0.82;
    const baseSpeed = isMusic ? 0.11 : 0.14;
    const speedRange = isMusic ? 0.1 : 0.13;
    return {
      amplitude: clamp(baseAmplitude + shapedEnergy * amplitudeRange + actionBoost * 0.12, 0.4, 1),
      speed: clamp(baseSpeed + shapedEnergy * speedRange + actionBoost * 0.04, 0.1, 0.34),
      opacity: waveformAlpha
    };
  }

  const api = {
    DEFAULT_CURVE_DEFINITION,
    DEFAULT_RANGES,
    resolveSiriWaveLayout,
    resolveSiriWaveMotion,
    stabilizeSiriWaveInstance
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.RendererSiriWaveBridge = api;
})(typeof window !== 'undefined' ? window : globalThis);
