const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLayoutOverrides,
  computeResizeRequestFromDrag,
  createResizeModeController
} = require('../../apps/desktop-live2d/renderer/resizeMode');

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        return false;
      }
      this.tokens.add(token);
      return true;
    }
    if (force) {
      this.tokens.add(token);
      return true;
    }
    this.tokens.delete(token);
    return false;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeElement {
  constructor(id, { value = '', textContent = '' } = {}) {
    this.id = id;
    this.value = String(value);
    this.textContent = textContent;
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({
        currentTarget: this,
        target: this,
        preventDefault() {},
        ...event
      });
    }
  }

  click() {
    this.dispatch('click');
  }

  input(value) {
    this.value = String(value);
    this.dispatch('input');
  }
}

class FakeDocument {
  constructor(elements) {
    this.body = new FakeElement('body');
    this.elements = elements;
  }

  getElementById(id) {
    return this.elements[id] || null;
  }
}

function createControllerHarness() {
  const elements = {
    'resize-mode-close': new FakeElement('resize-mode-close'),
    'layout-tuner-toggle': new FakeElement('layout-tuner-toggle'),
    'layout-tuner-close': new FakeElement('layout-tuner-close'),
    'layout-reset': new FakeElement('layout-reset'),
    'layout-save': new FakeElement('layout-save'),
    'layout-tuner-status': new FakeElement('layout-tuner-status'),
    'layout-offset-x': new FakeElement('layout-offset-x', { value: '12' }),
    'layout-offset-y': new FakeElement('layout-offset-y', { value: '-8' }),
    'layout-scale': new FakeElement('layout-scale', { value: '1.10' }),
    'layout-offset-x-value': new FakeElement('layout-offset-x-value'),
    'layout-offset-y-value': new FakeElement('layout-offset-y-value'),
    'layout-scale-value': new FakeElement('layout-scale-value')
  };
  const document = new FakeDocument(elements);
  const bridgeCalls = [];
  const appliedLayouts = [];
  let runtimeLayout = {
    offsetX: 12,
    offsetY: -8,
    scaleMultiplier: 1.1
  };

  const controller = createResizeModeController({
    document,
    bridge: {
      sendWindowControl(payload) {
        bridgeCalls.push(payload);
      }
    },
    getLayoutConfig: () => runtimeLayout,
    setLayoutConfig: (layout) => {
      runtimeLayout = { ...runtimeLayout, ...layout };
    },
    onLayoutApplied: (layout) => {
      appliedLayouts.push(layout);
    }
  });

  return {
    controller,
    document,
    elements,
    bridgeCalls,
    appliedLayouts,
    getRuntimeLayout: () => ({ ...runtimeLayout })
  };
}

test('normalizeLayoutOverrides clamps layout tuner values into slider bounds', () => {
  const normalized = normalizeLayoutOverrides({
    offsetX: 999,
    offsetY: -999,
    scaleMultiplier: 4
  });

  assert.deepEqual(normalized, {
    offsetX: 120,
    offsetY: -120,
    scaleMultiplier: 1.5
  });
});

test('resize mode controller reacts to window-state sync and close actions', () => {
  const harness = createControllerHarness();

  harness.controller.handleWindowStateSync({
    resizeModeEnabled: true,
    width: 320,
    height: 500,
    aspectRatio: 0.64
  });
  harness.elements['layout-tuner-toggle'].click();

  assert.equal(harness.document.body.classList.contains('resize-mode-active'), true);
  assert.equal(harness.document.body.classList.contains('layout-tuner-open'), true);
  assert.deepEqual(harness.controller.getWindowState(), {
    resizeModeEnabled: true,
    width: 320,
    height: 500,
    aspectRatio: 0.64
  });

  harness.elements['resize-mode-close'].click();

  assert.equal(harness.document.body.classList.contains('resize-mode-active'), false);
  assert.equal(harness.document.body.classList.contains('layout-tuner-open'), false);
  assert.deepEqual(harness.bridgeCalls[0], { action: 'close_resize_mode' });
});

test('resize mode controller applies slider changes and persists saved overrides', () => {
  const harness = createControllerHarness();

  harness.controller.handleWindowStateSync({ resizeModeEnabled: true });
  harness.elements['layout-tuner-toggle'].click();
  harness.elements['layout-offset-x'].input('18');
  harness.elements['layout-offset-y'].input('-11');
  harness.elements['layout-scale'].input('1.23');

  assert.deepEqual(harness.appliedLayouts.at(-1), {
    offsetX: 18,
    offsetY: -11,
    scaleMultiplier: 1.23
  });
  assert.equal(harness.elements['layout-tuner-status'].textContent, 'Unsaved changes');

  harness.elements['layout-save'].click();

  assert.deepEqual(harness.bridgeCalls.at(-1), {
    action: 'save_layout_overrides',
    layout: {
      offsetX: 18,
      offsetY: -11,
      scaleMultiplier: 1.23
    }
  });
  assert.deepEqual(harness.getRuntimeLayout(), {
    offsetX: 18,
    offsetY: -11,
    scaleMultiplier: 1.23
  });
  assert.equal(harness.elements['layout-tuner-status'].textContent, 'Saved');

  harness.elements['layout-reset'].click();

  assert.deepEqual(harness.getRuntimeLayout(), {
    offsetX: 0,
    offsetY: 95,
    scaleMultiplier: 1.25
  });
  assert.equal(harness.elements['layout-tuner-status'].textContent, 'Reset to defaults');
});

test('computeResizeRequestFromDrag keeps aspect ratio while honoring dominant drag axis', () => {
  const grow = computeResizeRequestFromDrag({
    startWidth: 320,
    startHeight: 500,
    aspectRatio: 0.64,
    deltaX: 5,
    deltaY: 60,
    persist: false
  });
  const shrink = computeResizeRequestFromDrag({
    startWidth: 320,
    startHeight: 500,
    aspectRatio: 0.64,
    deltaX: -90,
    deltaY: -20,
    persist: true
  });

  assert.deepEqual(grow, {
    action: 'set',
    width: 358,
    height: 559,
    persist: false,
    source: 'resize-mode'
  });
  assert.deepEqual(shrink, {
    action: 'set',
    width: 230,
    height: 359,
    persist: true,
    source: 'resize-mode'
  });
});
