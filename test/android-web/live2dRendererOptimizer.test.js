'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Optimizer = require('../../apps/android/app/src/main/assets/web/js/live2dRendererOptimizer');

function fixture({ throwOnDraw = false } = {}) {
  const vertices = [new Float32Array([0, 0, 1, 1]), new Float32Array([2, 2, 3, 3, 4, 4])];
  const uvs = [new Float32Array([0, 0, 1, 1]), new Float32Array([0, 0, 0.5, 0.5, 1, 1])];
  const indices = [new Uint16Array([0, 1, 0]), new Uint16Array([0, 1, 2])];
  const calls = { bufferData: 0, bufferSubData: 0, useProgram: [], offsets: [], attribOffsets: [], deleted: 0, passes: 0 };
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, DYNAMIC_DRAW: 3, STATIC_DRAW: 4,
    createBuffer: () => ({}), bindBuffer() {},
    bufferData() { calls.bufferData += 1; },
    bufferSubData() { calls.bufferSubData += 1; },
    useProgram(program) { calls.useProgram.push(program); },
    vertexAttribPointer(index, size, type, normalized, stride, offset) { calls.attribOffsets.push(offset); },
    drawElements(mode, count, type, offset) { calls.offsets.push(offset); },
    deleteBuffer() { calls.deleted += 1; }
  };
  const originalBufferData = { vertex: null, uv: null, index: null };
  const renderer = {
    gl, _bufferData: originalBufferData,
    getClippingContextBufferForMask: () => null,
    drawMesh(texture, count, verticesCount, indexArray, vertexArray, uvArray) {
      const buffers = this._bufferData;
      if (!buffers.vertex) buffers.vertex = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex); gl.bufferData(gl.ARRAY_BUFFER, vertexArray, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 2, 0, false, 0, 0);
      if (!buffers.uv) buffers.uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv); gl.bufferData(gl.ARRAY_BUFFER, uvArray, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(1, 2, 0, false, 0, 0);
      if (!buffers.index) buffers.index = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.DYNAMIC_DRAW);
      gl.useProgram('program');
      gl.drawElements(0, count, 0, 0);
      gl.useProgram(null);
    },
    drawModel() {
      calls.passes += 1;
      this.drawMesh(0, 3, 2, indices[0], vertices[0], uvs[0], 1);
      if (throwOnDraw) throw new Error('draw failed');
      this.drawMesh(0, 3, 3, indices[1], vertices[1], uvs[1], 1);
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
  assert.equal(installed.stats.drawCalls, 4);
  assert.equal(installed.stats.bufferUploads, 5);

  installed.detach();
  assert.equal(f.calls.deleted, 3);
  assert.equal(f.renderer._bufferData, f.originalBufferData);
});

test('renderer optimizer restores GL methods and propagates a draw failure without retrying the pass', () => {
  const f = fixture({ throwOnDraw: true });
  const nativeDrawElements = f.gl.drawElements;
  Optimizer.install(f.renderer, f.model);
  assert.throws(() => f.renderer.drawModel(), /draw failed/);
  assert.equal(f.calls.passes, 1);
  assert.equal(f.gl.drawElements, nativeDrawElements);
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
