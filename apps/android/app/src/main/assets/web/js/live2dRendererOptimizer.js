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
      programChanges: 0, stateCallsSkipped: 0, bufferBinds: 0, textureBinds: 0,
      blendChanges: 0, uniformUpdates: 0, capabilityChanges: 0,
      packedVertexValues: vertexValues, packedIndexValues: indexValues
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
        drawElements: gl.drawElements,
        activeTexture: gl.activeTexture,
        bindTexture: gl.bindTexture,
        blendFuncSeparate: gl.blendFuncSeparate,
        enable: gl.enable,
        disable: gl.disable,
        frontFace: gl.frontFace,
        enableVertexAttribArray: gl.enableVertexAttribArray,
        uniform1i: gl.uniform1i,
        uniform4f: gl.uniform4f,
        uniformMatrix4fv: gl.uniformMatrix4fv
      };
      let activeProgram = null;
      let boundArrayBuffer = null;
      let activeTexture = null;
      let blend = null;
      let frontFace = null;
      const boundBuffers = new Map();
      const boundTextures = new Map();
      const capabilities = new Map();
      const enabledAttributes = new Set();
      const uniform1iValues = new Map();
      const uniform4fValues = new Map();
      const uniformMatrixValues = new Map();
      let patched = false;

      const skipStateCall = () => { stats.stateCallsSkipped += 1; };
      const restoreGlMethods = () => {
        for (const [name, method] of Object.entries(native)) {
          try { gl[name] = method; } catch { /* A native method may be read-only; leave it untouched. */ }
        }
      };
      try {
        gl.bindBuffer = function (target, buffer) {
          if (target === gl.ARRAY_BUFFER) boundArrayBuffer = buffer;
          if (boundBuffers.has(target) && boundBuffers.get(target) === buffer) { skipStateCall(); return undefined; }
          boundBuffers.set(target, buffer);
          stats.bufferBinds += 1;
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
        gl.activeTexture = function (texture) {
          if (activeTexture === texture) { skipStateCall(); return undefined; }
          activeTexture = texture;
          return native.activeTexture.call(gl, texture);
        };
        gl.bindTexture = function (target, texture) {
          let targets = boundTextures.get(activeTexture);
          if (!targets) { targets = new Map(); boundTextures.set(activeTexture, targets); }
          if (targets.has(target) && targets.get(target) === texture) { skipStateCall(); return undefined; }
          targets.set(target, texture);
          stats.textureBinds += 1;
          return native.bindTexture.call(gl, target, texture);
        };
        gl.blendFuncSeparate = function (srcColor, dstColor, srcAlpha, dstAlpha) {
          if (blend && blend[0] === srcColor && blend[1] === dstColor && blend[2] === srcAlpha && blend[3] === dstAlpha) {
            skipStateCall(); return undefined;
          }
          if (!blend) blend = [srcColor, dstColor, srcAlpha, dstAlpha];
          else { blend[0] = srcColor; blend[1] = dstColor; blend[2] = srcAlpha; blend[3] = dstAlpha; }
          stats.blendChanges += 1;
          return native.blendFuncSeparate.call(gl, srcColor, dstColor, srcAlpha, dstAlpha);
        };
        gl.enable = function (capability) {
          if (capabilities.get(capability) === true) { skipStateCall(); return undefined; }
          capabilities.set(capability, true);
          stats.capabilityChanges += 1;
          return native.enable.call(gl, capability);
        };
        gl.disable = function (capability) {
          if (capabilities.get(capability) === false) { skipStateCall(); return undefined; }
          capabilities.set(capability, false);
          stats.capabilityChanges += 1;
          return native.disable.call(gl, capability);
        };
        gl.frontFace = function (mode) {
          if (frontFace === mode) { skipStateCall(); return undefined; }
          frontFace = mode;
          return native.frontFace.call(gl, mode);
        };
        gl.enableVertexAttribArray = function (index) {
          if (enabledAttributes.has(index)) { skipStateCall(); return undefined; }
          enabledAttributes.add(index);
          return native.enableVertexAttribArray.call(gl, index);
        };
        gl.uniform1i = function (location, value) {
          if (location != null && uniform1iValues.get(location) === value) { skipStateCall(); return undefined; }
          if (location != null) uniform1iValues.set(location, value);
          stats.uniformUpdates += 1;
          return native.uniform1i.call(gl, location, value);
        };
        gl.uniform4f = function (location, x, y, z, w) {
          const previous = location != null && uniform4fValues.get(location);
          if (previous && previous[0] === x && previous[1] === y && previous[2] === z && previous[3] === w) {
            skipStateCall(); return undefined;
          }
          if (location != null) {
            if (previous) { previous[0] = x; previous[1] = y; previous[2] = z; previous[3] = w; }
            else uniform4fValues.set(location, [x, y, z, w]);
          }
          stats.uniformUpdates += 1;
          return native.uniform4f.call(gl, location, x, y, z, w);
        };
        gl.uniformMatrix4fv = function (location, transpose, values) {
          const previous = location != null && uniformMatrixValues.get(location);
          let same = !!previous && previous.transpose === transpose && previous.values.length === values.length;
          if (same) for (let i = 0; i < values.length; i += 1) { if (previous.values[i] !== values[i]) { same = false; break; } }
          if (same) { skipStateCall(); return undefined; }
          if (location != null) {
            if (previous && previous.values.length === values.length) {
              previous.transpose = transpose;
              previous.values.set(values);
            } else uniformMatrixValues.set(location, { transpose, values: Float32Array.from(values) });
          }
          stats.uniformUpdates += 1;
          return native.uniformMatrix4fv.call(gl, location, transpose, values);
        };
        gl.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
          const packed = current && (boundArrayBuffer === buffers.vertex || boundArrayBuffer === buffers.uv);
          return native.vertexAttribPointer.call(gl, index, size, type, normalized, stride, packed ? current.vertexByteOffset : offset);
        };
        gl.drawElements = function (mode, drawCount, type, offset) {
          stats.drawCalls += 1;
          return native.drawElements.call(gl, mode, drawCount, type, current ? current.indexByteOffset : offset);
        };
        patched = Object.entries(native).every(([name, method]) => typeof method === 'function' && gl[name] !== method);
        if (!patched) {
          restoreGlMethods();
          disabled = true;
          this._bufferData = originalBufferData;
          return originalDrawModel.apply(this, args);
        }
      } catch {
        restoreGlMethods();
        disabled = true;
        this._bufferData = originalBufferData;
        return originalDrawModel.apply(this, args);
      }

      try {
        return originalDrawModel.apply(this, args);
      } finally {
        // Draw failures remain failures; only restore the scoped wrappers here and never redraw the frame.
        native.useProgram.call(gl, null);
        restoreGlMethods();
      }
    };

    function resetStats() {
      for (const key of [
        'drawCalls', 'transparentSkipped', 'bufferUploads', 'bufferUploadBytes', 'programChanges',
        'stateCallsSkipped', 'bufferBinds', 'textureBinds', 'blendChanges', 'uniformUpdates', 'capabilityChanges'
      ]) stats[key] = 0;
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
