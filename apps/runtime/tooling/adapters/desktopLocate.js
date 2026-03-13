const fs = require('node:fs');

const { ProviderConfigStore } = require('../../config/providerConfigStore');
const { LlmProviderManager } = require('../../config/llmProviderManager');
const { ToolingError, ErrorCode } = require('../errors');
const { __internal: desktopPerceptionInternal } = require('./desktopPerception');
const { __internal: desktopVisionInternal } = require('./desktopVision');

const DEFAULT_LOCATE_SYSTEM_PROMPT = [
  'You are a desktop visual locator.',
  'Return strict JSON only. Do not wrap JSON in markdown.',
  'Locate the requested target only from the screenshot and prompt.',
  'If the target is not visible or uncertain, set found=false and return an empty matches array.',
  'All bounds must be pixel coordinates relative to the attached screenshot.',
  'Each match must include integer x/y/width/height and confidence from 0 to 1.',
  'Do not invent invisible elements.'
].join(' ');

function normalizeTarget(value) {
  const target = String(value || '').trim();
  if (!target) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'desktop locate requires non-empty target');
  }
  return target;
}

function normalizeTargetType(value) {
  const targetType = String(value || '').trim().toLowerCase();
  if (!targetType) return 'unknown';
  return targetType;
}

function normalizeExpectedCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function buildLocateMessages({ target, targetType, expectedCount, imageDataUrl, captureRecord }) {
  const imageWidth = Number(captureRecord?.pixel_size?.width) || 0;
  const imageHeight = Number(captureRecord?.pixel_size?.height) || 0;
  const desktopBounds = captureRecord?.bounds && typeof captureRecord.bounds === 'object'
    ? JSON.stringify(captureRecord.bounds)
    : 'null';
  const displayId = captureRecord?.display_id || null;
  const prompt = [
    `Target: ${target}`,
    `Target type: ${targetType}`,
    `Expected count: ${expectedCount}`,
    `Image pixel size: ${imageWidth}x${imageHeight}`,
    `Capture desktop bounds: ${desktopBounds}`,
    `Capture display_id: ${displayId || 'null'}`,
    'Return JSON with this schema:',
    '{"found":boolean,"summary":string,"matches":[{"label":string,"confidence":number,"pixel_bounds":{"x":integer,"y":integer,"width":integer,"height":integer},"reason":string}]}'
  ].join('\n');

  return [
    { role: 'system', content: DEFAULT_LOCATE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ];
}

function parseJsonObjectText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizePixelBounds(bounds, captureRecord) {
  const imageWidth = Math.max(0, Number(captureRecord?.pixel_size?.width) || 0);
  const imageHeight = Math.max(0, Number(captureRecord?.pixel_size?.height) || 0);
  const x = clampInt(bounds?.x, { min: 0, max: Math.max(0, imageWidth - 1) });
  const y = clampInt(bounds?.y, { min: 0, max: Math.max(0, imageHeight - 1) });
  const width = clampInt(bounds?.width, { min: 1, max: imageWidth || Number.MAX_SAFE_INTEGER });
  const height = clampInt(bounds?.height, { min: 1, max: imageHeight || Number.MAX_SAFE_INTEGER });
  if (x == null || y == null || width == null || height == null) {
    return null;
  }
  if (imageWidth > 0 && x + width > imageWidth) return null;
  if (imageHeight > 0 && y + height > imageHeight) return null;
  return { x, y, width, height };
}

function projectPixelBoundsToDesktopBounds(pixelBounds, captureRecord) {
  const captureBounds = captureRecord?.bounds;
  const pixelSize = captureRecord?.pixel_size;
  if (!captureBounds || !pixelSize) {
    return null;
  }
  const imageWidth = Math.max(1, Number(pixelSize.width) || 1);
  const imageHeight = Math.max(1, Number(pixelSize.height) || 1);
  const scaleX = (Number(captureBounds.width) || 0) / imageWidth;
  const scaleY = (Number(captureBounds.height) || 0) / imageHeight;
  return {
    x: Math.round((Number(captureBounds.x) || 0) + pixelBounds.x * scaleX),
    y: Math.round((Number(captureBounds.y) || 0) + pixelBounds.y * scaleY),
    width: Math.max(1, Math.round(pixelBounds.width * scaleX)),
    height: Math.max(1, Math.round(pixelBounds.height * scaleY))
  };
}

function boundsContainBounds(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function resolveDisplayForBounds(displays = [], desktopBounds = null) {
  if (!desktopBounds || !Array.isArray(displays) || displays.length === 0) {
    return null;
  }
  return displays.find((display) => boundsContainBounds(display.bounds, desktopBounds)) || null;
}

async function loadDisplays(invokeRpc, traceId = null) {
  try {
    const result = await invokeRpc({
      method: 'desktop.perception.displays.list',
      params: {},
      traceId
    });
    return Array.isArray(result?.displays) ? result.displays : [];
  } catch {
    return [];
  }
}

function normalizeLocateMatch(match = {}, captureRecord, displays = []) {
  const pixelBounds = normalizePixelBounds(match.pixel_bounds, captureRecord);
  if (!pixelBounds) return null;
  const desktopBounds = projectPixelBoundsToDesktopBounds(pixelBounds, captureRecord);
  const display = resolveDisplayForBounds(displays, desktopBounds);
  const confidenceRaw = Number(match.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;
  const displayRelativeBounds = display && desktopBounds
    ? {
        x: desktopBounds.x - display.bounds.x,
        y: desktopBounds.y - display.bounds.y,
        width: desktopBounds.width,
        height: desktopBounds.height
      }
    : null;
  return {
    label: String(match.label || '').trim() || 'target',
    confidence,
    pixel_bounds: pixelBounds,
    desktop_bounds: desktopBounds,
    display_id: display?.id || null,
    display_relative_bounds: displayRelativeBounds,
    reason: String(match.reason || '').trim() || null
  };
}

function extractLocatePayload(decision) {
  if (!decision || typeof decision !== 'object') {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop locate LLM returned no decision');
  }
  if (decision.type !== 'final') {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop locate LLM returned tool decision unexpectedly');
  }
  const parsed = parseJsonObjectText(decision.output);
  if (!parsed) {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop locate LLM did not return valid JSON');
  }
  return parsed;
}

function createDefaultReasonerProvider() {
  let manager = null;
  return () => {
    if (!manager) {
      manager = new LlmProviderManager({ store: new ProviderConfigStore() });
    }
    return manager.getReasoner();
  };
}

function buildLocateProgressPayload(stage, captureRecord = null, overrides = {}) {
  return {
    stage,
    capture_id: captureRecord?.capture_id || null,
    display_id: captureRecord?.display_id || null,
    display_ids: Array.isArray(captureRecord?.display_ids) ? captureRecord.display_ids : [],
    public_message: overrides.public_message || null,
    ...overrides
  };
}

function createDesktopLocateAdapters({
  invokeRpc = desktopPerceptionInternal.invokeDesktopRpc,
  getReasoner = createDefaultReasonerProvider(),
  fsModule = fs
} = {}) {
  const {
    normalizeCaptureRecord,
    readCaptureAsDataUrl,
    createProgressPublisher
  } = desktopVisionInternal;

  async function locateWithinCapture({ captureRecord, target, targetType, expectedCount, traceId = null, publishProgress = () => {} }) {
    const reasoner = await Promise.resolve(getReasoner());
    const imageDataUrl = readCaptureAsDataUrl(captureRecord, { fsModule });
    publishProgress(buildLocateProgressPayload('locate_started', captureRecord, {
      public_message: '截图已完成，正在定位目标位置。'
    }));
    const decision = await reasoner.decide({
      messages: buildLocateMessages({
        target,
        targetType,
        expectedCount,
        imageDataUrl,
        captureRecord
      }),
      tools: []
    });
    const rawLocate = extractLocatePayload(decision);
    const displays = await loadDisplays(invokeRpc, traceId);
    const matches = Array.isArray(rawLocate.matches)
      ? rawLocate.matches
          .map((match) => normalizeLocateMatch(match, captureRecord, displays))
          .filter(Boolean)
          .slice(0, expectedCount)
      : [];
    const found = matches.length > 0 && rawLocate.found !== false;
    publishProgress(buildLocateProgressPayload('locate_completed', captureRecord, {
      public_message: found ? '目标定位已完成。' : '未能在截图中稳定定位目标。'
    }));
    return JSON.stringify({
      ok: true,
      capture_id: captureRecord.capture_id,
      target,
      target_type: targetType,
      found,
      summary: String(rawLocate.summary || '').trim() || (found ? '目标定位成功。' : '未在截图中发现目标。'),
      display_id: captureRecord.display_id || null,
      display_ids: captureRecord.display_ids,
      bounds: captureRecord.bounds,
      pixel_size: captureRecord.pixel_size,
      scale_factor: captureRecord.scale_factor,
      matches
    });
  }

  async function captureAndLocate({ captureMethod, captureArgs = {}, args = {}, context = {} }) {
    const publishProgress = createProgressPublisher(context.publishEvent);
    const target = normalizeTarget(args.target);
    const targetType = normalizeTargetType(args.target_type || args.targetType);
    const expectedCount = normalizeExpectedCount(args.expected_count || args.expectedCount);
    const captureRecord = normalizeCaptureRecord(await invokeRpc({
      method: captureMethod,
      params: desktopVisionInternal.sanitizeCaptureArgs(captureArgs),
      traceId: context.trace_id || null
    }));
    publishProgress(buildLocateProgressPayload('capture_completed', captureRecord, {
      public_message: '截图已完成，正在准备定位目标。'
    }));
    return locateWithinCapture({
      captureRecord,
      target,
      targetType,
      expectedCount,
      traceId: context.trace_id || null,
      publishProgress
    });
  }

  return {
    'desktop.locate.capture': async (args = {}, context = {}) => {
      const target = normalizeTarget(args.target);
      const targetType = normalizeTargetType(args.target_type || args.targetType);
      const expectedCount = normalizeExpectedCount(args.expected_count || args.expectedCount);
      const publishProgress = createProgressPublisher(context.publishEvent);
      const captureRecord = normalizeCaptureRecord(await invokeRpc({
        method: 'desktop.capture.get',
        params: desktopVisionInternal.normalizeCaptureLookupArgs(args),
        traceId: context.trace_id || null
      }));
      publishProgress(buildLocateProgressPayload('capture_loaded', captureRecord, {
        public_message: '已读取已有截图，正在准备定位目标。'
      }));
      return locateWithinCapture({
        captureRecord,
        target,
        targetType,
        expectedCount,
        traceId: context.trace_id || null,
        publishProgress
      });
    },
    'desktop.locate.desktop': async (args = {}, context = {}) => captureAndLocate({
      captureMethod: 'desktop.capture.desktop',
      captureArgs: args,
      args,
      context
    })
  };
}

const adapters = createDesktopLocateAdapters();

module.exports = {
  ...adapters,
  __internal: {
    DEFAULT_LOCATE_SYSTEM_PROMPT,
    normalizeTarget,
    normalizeTargetType,
    normalizeExpectedCount,
    buildLocateMessages,
    parseJsonObjectText,
    normalizePixelBounds,
    projectPixelBoundsToDesktopBounds,
    resolveDisplayForBounds,
    normalizeLocateMatch,
    extractLocatePayload,
    buildLocateProgressPayload,
    createDesktopLocateAdapters
  }
};
