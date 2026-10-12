'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Optimizer = require('../../apps/android/app/src/main/assets/web/js/live2dRendererOptimizer');

function fixture({ throwOnDraw = false, varyState = false } = {}) {
  const vertices = [new Float32Array([0, 0, 1, 1]), new Float32Array([2, 2, 3, 3, 4, 4])];
  const uvs = [new Float32Array([0, 0, 1, 1]), new Float32Array([0, 0, 0.5, 0.5, 1, 1])];
  const indices = [new Uint16Array([0, 1, 0]), new Uint16Array([0, 1, 2])];
  const calls = {
    bufferData: 0, bufferSubData: 0, useProgram: [], offsets: [], attribOffsets: [], deleted: 0, passes: 0,
    activeTexture: 0, bindTexture: 0, blend: 0, enable: 0, disable: 0, frontFace: 0,
    enableAttribute: 0, uniform1i: 0, uniform4f: 0, uniformMatrix: 0
  };
  const samplerLocation = {};
  const baseColorLocation = {};
  const matrixLocation = {};
  const matrix = new Float32Array(16);
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, DYNAMIC_DRAW: 3, STATIC_DRAW: 4,
    TEXTURE0: 5, TEXTURE1: 6, TEXTURE_2D: 7, CULL_FACE: 8, CCW: 9, CW: 10,
    createBuffer: () => ({}), bindBuffer() {},
    bufferData() { calls.bufferData += 1; },
    bufferSubData() { calls.bufferSubData += 1; },
    useProgram(program) { calls.useProgram.push(program); },
    activeTexture() { calls.activeTexture += 1; },
    bindTexture() { calls.bindTexture += 1; },
    blendFuncSeparate() { calls.blend += 1; },
    enable() { calls.enable += 1; },
    disable() { calls.disable += 1; },
    frontFace() { calls.frontFace += 1; },
    enableVertexAttribArray() { calls.enableAttribute += 1; },
    uniform1i() { calls.uniform1i += 1; },
    uniform4f() { calls.uniform4f += 1; },
    uniformMatrix4fv() { calls.uniformMatrix += 1; },
    vertexAttribPointer(index, size, type, normalized, stride, offset) { calls.attribOffsets.push(offset); },
    drawElements(mode, count, type, offset) { calls.offsets.push(offset); },
    deleteBuffer() { calls.deleted += 1; }
  };
  const originalBufferData = { vertex: null, uv: null, index: null };
  const renderer = {
    gl, _bufferData: originalBufferData,
    getClippingContextBufferForMask: () => null,
    drawMesh(texture, count, verticesCount, indexArray, vertexArray, uvArray, opacity) {
    gl.enable(gl.CULL_FACE);
      if (texture === 1) gl.disable(gl.CULL_FACE);
      gl.frontFace(texture === 1 ? gl.CW : gl.CCW);
      gl.useProgram(texture === 1 ? 'mask-program' : 'program');
      if (texture === 1) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, 'mask-texture');
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, `texture-${texture}`);
      gl.uniform1i(samplerLocation, 0);
      const buffers = this._bufferData;
      if (!buffers.vertex) buffers.vertex = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex); gl.bufferData(gl.ARRAY_BUFFER, vertexArray, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, 0, false, 0, 0);
      if (!buffers.uv) buffers.uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv); gl.bufferData(gl.ARRAY_BUFFER, uvArray, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, 0, false, 0, 0);
      gl.uniformMatrix4fv(matrixLocation, false, matrix);
      gl.uniform4f(baseColorLocation, 1, 1, 1, opacity);
      if (!buffers.index) buffers.index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.DYNAMIC_DRAW);
      gl.blendFuncSeparate(texture === 1 ? 5 : 1, 2, 3, 4);
      gl.drawElements(0, count, 0, 0);
      gl.useProgram(null);
    },
    drawModel() {
      calls.passes += 1;
      this.drawMesh(0, 3, 2, indices[0], vertices[0], uvs[0], 1);
      if (throwOnDraw) throw new Error('draw failed');
      this.drawMesh(varyState ? 1 : 0, 3, 3, indices[1], vertices[1], uvs[1], 1);
    }
  };
  const model = {
    getDrawableCount: () => 2,
    getDrawableVertices: (i) => vertices[i],
    getDrawableVertexUvs: (i) => uvs[i],
    getDrawableVertexIndices: (i) => indices[i]
  };
  return { calls, gl, renderer, model, originalBufferData };
}

test('renderer optimizer packs model buffers and offsets each original draw without reordering', () => {
  const f = fixture();
  const installed = Optimizer.install(f.renderer, f.model);
  f.renderer.drawModel();
  f.renderer.drawModel();

  assert.equal(f.calls.bufferData, 3, 'packed position/UV/index storage is allocated once');
  assert.equal(f.calls.bufferSubData, 2, 'all positions are uploaded once per model frame');
  assert.deepEqual(f.calls.offsets, [0, 6, 0, 6]);
  assert.deepEqual(f.calls.attribOffsets, [0, 0, 16, 16, 0, 0, 16, 16]);
  assert.deepEqual(f.calls.useProgram, ['program', null, 'program', null]);
  assert.equal(f.calls.activeTexture, 2, 'active texture is set once per model pass');
  assert.equal(f.calls.bindTexture, 2, 'unchanged texture binding is reused within each pass');
  assert.equal(f.calls.blend, 2, 'unchanged blend function is reused within each pass');
  assert.equal(f.calls.enable, 2, 'unchanged cull capability is reused within each pass');
  assert.equal(f.calls.frontFace, 2, 'unchanged front-face mode is reused within each pass');
  assert.equal(f.calls.enableAttribute, 4, 'each attribute is enabled once per pass');
  assert.equal(f.calls.uniform1i, 2, 'unchanged sampler uniform is reused within each pass');
  assert.equal(f.calls.uniformMatrix, 2, 'unchanged model matrix is reused within each pass');
  assert.equal(installed.stats.drawCalls, 4);
  assert.equal(installed.stats.bufferUploads, 5);
  assert.ok(installed.stats.stateCallsSkipped >= 18);

  installed.detach();
  assert.equal(f.calls.deleted, 3);
  assert.equal(f.renderer._bufferData, f.originalBufferData);
});

test('renderer optimizer restores GL methods and propagates a draw failure without retrying the pass', () => {
  const f = fixture({ throwOnDraw: true });
  const native = Object.fromEntries([
    'bindBuffer', 'bufferData', 'useProgram', 'vertexAttribPointer', 'drawElements', 'activeTexture',
    'bindTexture', 'blendFuncSeparate', 'enable', 'disable', 'frontFace', 'enableVertexAttribArray',
    'uniform1i', 'uniform4f', 'uniformMatrix4fv'
  ].map((name) => [name, f.gl[name]]));
  Optimizer.install(f.renderer, f.model);
  assert.throws(() => f.renderer.drawModel(), /draw failed/);
  assert.equal(f.calls.passes, 1);
  for (const [name, method] of Object.entries(native)) assert.equal(f.gl[name], method, `${name} restored`);
});

test('renderer optimizer falls back when a WebGL method cannot be wrapped', () => {
  const f = fixture();
  const nativeUniform = f.gl.uniform4f;
  Object.defineProperty(f.gl, 'uniform4f', { value: nativeUniform, writable: false, configurable: true });
  const installed = Optimizer.install(f.renderer, f.model);
  assert.doesNotThrow(() => f.renderer.drawModel());
  assert.equal(f.calls.passes, 1);
  assert.equal(f.gl.uniform4f, nativeUniform);
  assert.equal(installed.stats.drawCalls, 0, 'fallback draw is not reported as an optimized pass');
});

test('renderer optimizer preserves changed mask, texture, blend, and cull state', () => {
  const f = fixture({ varyState: true });
  const installed = Optimizer.install(f.renderer, f.model);
  f.renderer.drawModel();
  assert.deepEqual(f.calls.useProgram, ['program', 'mask-program', null]);
  assert.equal(f.calls.bindTexture, 3, 'texture unit zero and mask unit changes reach WebGL');
  assert.equal(f.calls.blend, 2, 'a changed blend tuple is not cached away');
  assert.equal(f.calls.enable, 1);
  assert.equal(f.calls.disable, 1, 'a changed cull state is not cached away');
  assert.equal(f.calls.frontFace, 2, 'a changed winding mode is not cached away');
  assert.equal(installed.stats.drawCalls, 2);
});

test('renderer optimizer skips transparent non-mask drawables', () => {
  const f = fixture();
  let draws = 0;
  f.renderer.drawMesh = () => { draws += 1; };
  const installed = Optimizer.install(f.renderer, f.model);
  f.renderer.drawMesh(0, 3, 2, new Uint16Array(3), new Float32Array(4), new Float32Array(4), 0);
  assert.equal(draws, 0);
  assert.equal(installed.stats.transparentSkipped, 1);
});
