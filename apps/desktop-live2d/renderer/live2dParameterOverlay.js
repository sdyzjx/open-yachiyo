(function initLive2dParameterOverlay(globalScope) {
  function createLive2dParameterOverlay({ attack = 0.22, release: releaseAlpha = 0.22, epsilon = 0.01 } = {}) {
    const values = new Map();

    function set(name, target, source = 'rpc') {
      const existing = values.get(name);
      if (existing) {
        existing.target = target;
        existing.goal = 1;
        existing.source = source;
      } else {
        values.set(name, { target, weight: 0, goal: 1, source });
      }
    }

    function release(names) {
      for (const [name, overlay] of values) {
        if (!names || names.includes(name)) overlay.goal = 0;
      }
    }

    function apply(coreModel) {
      if (!coreModel || typeof coreModel.getParameterValueById !== 'function' || typeof coreModel.setParameterValueById !== 'function') return 0;
      let applied = 0;
      for (const [name, overlay] of values) {
        const alpha = overlay.goal > overlay.weight ? attack : releaseAlpha;
        overlay.weight += (overlay.goal - overlay.weight) * alpha;
        if (overlay.goal === 0 && overlay.weight < epsilon) {
          values.delete(name);
          continue;
        }
        const current = coreModel.getParameterValueById(name);
        coreModel.setParameterValueById(name, current + (overlay.target - current) * overlay.weight);
        applied += 1;
      }
      return applied;
    }

    function snapshot() {
      return Array.from(values, ([name, overlay]) => ({ name, ...overlay }));
    }

    return { set, release, apply, snapshot };
  }

  const api = { createLive2dParameterOverlay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.Live2DParameterOverlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

