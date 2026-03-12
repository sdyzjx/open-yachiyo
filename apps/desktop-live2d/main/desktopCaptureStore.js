const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_CAPTURE_TTL_MS = 5 * 60 * 1000;

function cloneRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : null;
}

function createDesktopCaptureStore({
  captureDir,
  ttlMs = DEFAULT_CAPTURE_TTL_MS,
  now = () => Date.now(),
  fsModule = fs,
  pathModule = path,
  randomId = () => randomUUID().replace(/-/g, '').slice(0, 12)
} = {}) {
  if (!captureDir) {
    throw new Error('desktop capture store requires captureDir');
  }

  const records = new Map();

  function ensureCaptureDir() {
    fsModule.mkdirSync(captureDir, { recursive: true });
  }

  function buildCapturePath(captureId, extension = 'png') {
    return pathModule.resolve(captureDir, `${captureId}.${extension}`);
  }

  function createCaptureRecord({
    scope,
    displayId,
    mimeType = 'image/png',
    bounds,
    pixelSize,
    scaleFactor,
    buffer,
    extension = 'png',
    extra = {}
  } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('capture store requires non-empty image buffer');
    }
    const createdAt = now();
    const captureId = `cap_${randomId()}`;
    const filePath = buildCapturePath(captureId, extension);
    ensureCaptureDir();
    fsModule.writeFileSync(filePath, buffer);
    const record = {
      capture_id: captureId,
      scope: String(scope || 'unknown'),
      display_id: String(displayId || ''),
      path: filePath,
      mime_type: String(mimeType || 'image/png'),
      bounds: bounds ? { ...bounds } : null,
      pixel_size: pixelSize ? { ...pixelSize } : null,
      scale_factor: Number(scaleFactor) || 1,
      created_at: createdAt,
      expires_at: createdAt + Math.max(1, Number(ttlMs) || DEFAULT_CAPTURE_TTL_MS),
      ...extra
    };
    records.set(captureId, record);
    return cloneRecord(record);
  }

  function getCaptureRecord(captureId) {
    const normalizedCaptureId = String(captureId || '').trim();
    if (!normalizedCaptureId) {
      return null;
    }
    const record = records.get(normalizedCaptureId);
    if (!record) {
      return null;
    }
    if (record.expires_at <= now()) {
      deleteCaptureRecord(normalizedCaptureId);
      return null;
    }
    return cloneRecord(record);
  }

  function deleteCaptureRecord(captureId) {
    const normalizedCaptureId = String(captureId || '').trim();
    if (!normalizedCaptureId) {
      return { ok: false, deleted: false, capture_id: normalizedCaptureId };
    }
    const record = records.get(normalizedCaptureId);
    if (!record) {
      return { ok: true, deleted: false, capture_id: normalizedCaptureId };
    }
    records.delete(normalizedCaptureId);
    try {
      if (fsModule.existsSync(record.path)) {
        fsModule.unlinkSync(record.path);
      }
    } catch {
      // best-effort cleanup
    }
    return { ok: true, deleted: true, capture_id: normalizedCaptureId };
  }

  function cleanupExpiredCaptures(referenceNow = now()) {
    const deleted = [];
    for (const [captureId, record] of records.entries()) {
      if (record.expires_at > referenceNow) {
        continue;
      }
      const result = deleteCaptureRecord(captureId);
      if (result.deleted) {
        deleted.push(captureId);
      }
    }
    return {
      ok: true,
      deleted_count: deleted.length,
      deleted_capture_ids: deleted
    };
  }

  return {
    captureDir: pathModule.resolve(captureDir),
    ttlMs: Math.max(1, Number(ttlMs) || DEFAULT_CAPTURE_TTL_MS),
    createCaptureRecord,
    getCaptureRecord,
    deleteCaptureRecord,
    cleanupExpiredCaptures
  };
}

module.exports = {
  DEFAULT_CAPTURE_TTL_MS,
  createDesktopCaptureStore
};
