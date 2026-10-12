/* Packed model buffers and scoped GL state cache for pixi-live2d-display 0.4. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoLive2DRendererOptimizer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function install(renderer, model) {
    if (!renderer || !model || typeof renderer.drawMesh !== 'function' || typeof renderer.drawModel !== 'function') return null;
    const originalDrawMesh = renderer.drawMesh;
    const originalDrawModel = renderer.drawModel;
    const originalBufferData = renderer._bufferData;
    const entriesByVertices = new WeakMap();
    const entries = [];
    const count = model.getDrawableCount();
    let vertexValues = 0;
    let indexValues = 0;
    for (let i = 0; i < count; i += 1) {
      const vertexArray = model.getDrawableVertices(i);
      const uvArray = model.getDrawableVertexUvs(i);
      const indexArray = model.getDrawableVertexIndices(i);
      const entry = {
        vertexArray, uvArray, indexArray,
        vertexValueOffset: vertexValues,
        vertexByteOffset: vertexValues * Float32Array.BYTES_PER_ELEMENT,
        indexValueOffset: indexValues,
        indexByteOffset: indexValues * Uint16Array.BYTES_PER_ELEMENT
      };
      entries.push(entry);
      entriesByVertices.set(vertexArray, entry);
      vertexValues += vertexArray.length;
      indexValues += indexArray.length;
    }
    const packedVertices = new Float32Array(vertexValues);
    const packedUvs = new Float32Array(vertexValues);
    const packedIndices = new Uint16Array(indexValues);
    for (const entry of entries) {
      packedUvs.set(entry.uvArray, entry.vertexValueOffset);
      packedIndices.set(entry.indexArray, entry.indexValueOffset);
    }

    const buffers = { vertex: null, uv: null, index: null };
    const stats = {
      drawCalls: 0, transparentSkipped: 0, bufferUploads: 0, bufferUploadBytes: 0,
      programChanges: 0, packedVertexValues: vertexValues, packedIndexValues: indexValues
    };
    let current = null;
    let initialized = false;
    let detached = false;
    let disabled = false;

    renderer.drawMesh = function (...args) {
      const opacity = Number(args[6]);
      if (opacity <= 0.001 && !this.getClippingContextBufferForMask()) {
        stats.transparentSkipped += 1;
        return undefined;
      }
      const entry = entriesByVertices.get(args[4]);
      if (!entry || !initialized || disabled) {
        this._bufferData = originalBufferData;
        return originalDrawMesh.apply(this, args);
      }
      this._bufferData = buffers;
      current = entry;
      try { return originalDrawMesh.apply(this, args); } finally { current = null; }
    };

    renderer.drawModel = function (...args) {
      const gl = this.gl;
      if (!gl || detached || disabled) return originalDrawModel.apply(this, args);
      for (const entry of entries) packedVertices.set(entry.vertexArray, entry.vertexValueOffset);
      if (!initialized) {
        buffers.vertex = gl.createBuffer();
        buffers.uv = gl.createBuffer();
        buffers.index = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex);
        gl.bufferData(gl.ARRAY_BUFFER, packedVertices.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        gl.bufferData(gl.ARRAY_BUFFER, packedUvs, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packedIndices, gl.STATIC_DRAW);
        stats.bufferUploads += 3;
        stats.bufferUploadBytes += packedVertices.byteLength + packedUvs.byteLength + packedIndices.byteLength;
        initialized = true;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertex);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packedVertices);
      stats.bufferUploads += 1;
      stats.bufferUploadBytes += packedVertices.byteLength;

      const native = {
        bindBuffer: gl.bindBuffer,
        bufferData: gl.bufferData,
        useProgram: gl.useProgram,
        vertexAttribPointer: gl.vertexAttribPointer,
        drawElements: gl.drawElements
      };
      let activeProgram = null;
      let boundArrayBuffer = null;
      let patched = false;
      try {
        gl.bindBuffer = function (target, buffer) {
          if (target === gl.ARRAY_BUFFER) boundArrayBuffer = buffer;
          return native.bindBuffer.call(gl, target, buffer);
        };
        gl.bufferData = function (target, data, usage) {
          if (current && (data === current.vertexArray || data === current.uvArray || data === current.indexArray)) return undefined;
          return native.bufferData.call(gl, target, data, usage);
        };
        gl.useProgram = function (program) {
          if (program == null || program === activeProgram) return undefined;
          activeProgram = program;
          stats.programChanges += 1;
          return native.useProgram.call(gl, program);
        };
        gl.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
          const packed = current && (boundArrayBuffer === buffers.vertex || boundArrayBuffer === buffers.uv);
          return native.vertexAttribPointer.call(gl, index, size, type, normalized, stride, packed ? current.vertexByteOffset : offset);
        };
        gl.drawElements = function (mode, drawCount, type, offset) {
          stats.drawCalls += 1;
          return native.drawElements.call(gl, mode, drawCount, type, current ? current.indexByteOffset : offset);
        };
        patched = gl.bindBuffer !== native.bindBuffer && gl.bufferData !== native.bufferData &&
          gl.useProgram !== native.useProgram && gl.vertexAttribPointer !== native.vertexAttribPointer &&
          gl.drawElements !== native.drawElements;
        if (!patched) {
          gl.bindBuffer = native.bindBuffer;
          gl.bufferData = native.bufferData;
          gl.useProgram = native.useProgram;
          gl.vertexAttribPointer = native.vertexAttribPointer;
          gl.drawElements = native.drawElements;
          disabled = true;
          this._bufferData = originalBufferData;
          return originalDrawModel.apply(this, args);
        }
      } catch {
        gl.bindBuffer = native.bindBuffer;
        gl.bufferData = native.bufferData;
        gl.useProgram = native.useProgram;
        gl.vertexAttribPointer = native.vertexAttribPointer;
        gl.drawElements = native.drawElements;
        disabled = true;
        this._bufferData = originalBufferData;
        return originalDrawModel.apply(this, args);
      }

      try {
        return originalDrawModel.apply(this, args);
      } finally {
        // Draw failures remain failures; only restore the scoped wrappers here and never redraw the frame.
        native.useProgram.call(gl, null);
        gl.bindBuffer = native.bindBuffer;
        gl.bufferData = native.bufferData;
        gl.useProgram = native.useProgram;
        gl.vertexAttribPointer = native.vertexAttribPointer;
        gl.drawElements = native.drawElements;
      }
    };

    function resetStats() {
      for (const key of ['drawCalls', 'transparentSkipped', 'bufferUploads', 'bufferUploadBytes', 'programChanges']) stats[key] = 0;
    }

    function detach() {
      if (detached) return;
      detached = true;
      renderer.drawMesh = originalDrawMesh;
      renderer.drawModel = originalDrawModel;
      renderer._bufferData = originalBufferData;
      const gl = renderer.gl;
      if (gl) for (const buffer of Object.values(buffers)) { if (buffer) gl.deleteBuffer(buffer); }
      buffers.vertex = null;
      buffers.uv = null;
      buffers.index = null;
    }

    return { stats, resetStats, detach };
  }

  return { install };
});
