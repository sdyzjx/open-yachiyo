const fs = require('node:fs');

const { ProviderConfigStore } = require('../../config/providerConfigStore');
const { LlmProviderManager } = require('../../config/llmProviderManager');
const { ToolingError, ErrorCode } = require('../errors');
const { __internal: desktopPerceptionInternal } = require('./desktopPerception');

const DEFAULT_INSPECT_SYSTEM_PROMPT = [
  'You are a desktop visual inspection assistant.',
  'Answer only from the screenshot content and the user prompt.',
  'Do not invent invisible details.',
  'If the screenshot is ambiguous, say what is uncertain.',
  'Keep the answer concise and actionable.'
].join(' ');

function normalizePrompt(value) {
  const prompt = String(value || '').trim();
  if (!prompt) {
    throw new ToolingError(ErrorCode.VALIDATION_ERROR, 'desktop inspect requires non-empty prompt');
  }
  return prompt;
}

function normalizeCaptureRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop capture record is missing');
  }
  const captureId = String(record.capture_id || '').trim();
  const capturePath = String(record.path || '').trim();
  if (!captureId || !capturePath) {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop capture record is incomplete');
  }
  return {
    capture_id: captureId,
    path: capturePath,
    mime_type: String(record.mime_type || 'image/png').trim() || 'image/png',
    display_id: String(record.display_id || '').trim(),
    display_ids: Array.isArray(record.display_ids)
      ? record.display_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    source_id: String(record.source_id || '').trim() || null,
    window_title: String(record.window_title || '').trim() || null,
    bounds: record.bounds && typeof record.bounds === 'object' ? { ...record.bounds } : null,
    pixel_size: record.pixel_size && typeof record.pixel_size === 'object' ? { ...record.pixel_size } : null,
    scale_factor: Number(record.scale_factor) || 1
  };
}

function readCaptureAsDataUrl(record, { fsModule = fs } = {}) {
  const capture = normalizeCaptureRecord(record);
  if (!fsModule.existsSync(capture.path)) {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, `desktop capture file not found: ${capture.path}`, {
      capture_id: capture.capture_id
    });
  }
  const buffer = fsModule.readFileSync(capture.path);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, `desktop capture file is empty: ${capture.path}`, {
      capture_id: capture.capture_id
    });
  }
  return `data:${capture.mime_type};base64,${buffer.toString('base64')}`;
}

function buildInspectMessages({ prompt, imageDataUrl }) {
  return [
    { role: 'system', content: DEFAULT_INSPECT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ];
}

function sanitizeCaptureArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {};
  }
  const cloned = { ...args };
  delete cloned.prompt;
  return cloned;
}

function normalizeInspectError(err, { stage, captureId = null } = {}) {
  if (err instanceof ToolingError) {
    if (captureId && (!err.details || !Object.hasOwn(err.details, 'capture_id'))) {
      err.details = {
        ...(err.details || {}),
        capture_id: captureId,
        stage
      };
    }
    return err;
  }

  return new ToolingError(
    ErrorCode.RUNTIME_ERROR,
    `desktop inspect failed during ${stage}: ${err?.message || String(err || 'unknown error')}`,
    {
      stage,
      capture_id: captureId
    }
  );
}

function extractFinalAnalysis(decision) {
  if (!decision || typeof decision !== 'object') {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop inspect LLM returned no decision');
  }
  if (decision.type !== 'final') {
    throw new ToolingError(ErrorCode.RUNTIME_ERROR, 'desktop inspect LLM returned tool decision unexpectedly');
  }
  return String(decision.output || '').trim() || '模型未返回文本输出。';
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

function createDesktopVisionAdapters({
  invokeRpc = desktopPerceptionInternal.invokeDesktopRpc,
  getReasoner = createDefaultReasonerProvider(),
  fsModule = fs
} = {}) {
  async function inspectViaCapture({ captureMethod, captureArgs = {}, prompt, traceId = null }) {
    const normalizedPrompt = normalizePrompt(prompt);
    let captureRecord = null;
    try {
      captureRecord = normalizeCaptureRecord(await invokeRpc({
        method: captureMethod,
        params: sanitizeCaptureArgs(captureArgs),
        traceId
      }));
    } catch (err) {
      throw normalizeInspectError(err, { stage: 'capture' });
    }

    let imageDataUrl;
    try {
      imageDataUrl = readCaptureAsDataUrl(captureRecord, { fsModule });
    } catch (err) {
      throw normalizeInspectError(err, {
        stage: 'read_capture',
        captureId: captureRecord.capture_id
      });
    }

    try {
      const reasoner = await Promise.resolve(getReasoner());
      const decision = await reasoner.decide({
        messages: buildInspectMessages({
          prompt: normalizedPrompt,
          imageDataUrl
        }),
        tools: []
      });
      const analysis = extractFinalAnalysis(decision);
      return JSON.stringify({
        ok: true,
        capture_id: captureRecord.capture_id,
        display_id: captureRecord.display_id || null,
        display_ids: captureRecord.display_ids,
        source_id: captureRecord.source_id,
        window_title: captureRecord.window_title,
        bounds: captureRecord.bounds,
        pixel_size: captureRecord.pixel_size,
        scale_factor: captureRecord.scale_factor,
        analysis
      });
    } catch (err) {
      throw normalizeInspectError(err, {
        stage: 'analyze',
        captureId: captureRecord.capture_id
      });
    }
  }

  return {
    'desktop.inspect.desktop': async (args = {}, context = {}) => inspectViaCapture({
      captureMethod: 'desktop.capture.desktop',
      captureArgs: args,
      prompt: args.prompt,
      traceId: context.trace_id || null
    }),
    'desktop.inspect.screen': async (args = {}, context = {}) => inspectViaCapture({
      captureMethod: 'desktop.capture.screen',
      captureArgs: args,
      prompt: args.prompt,
      traceId: context.trace_id || null
    }),
    'desktop.inspect.region': async (args = {}, context = {}) => inspectViaCapture({
      captureMethod: 'desktop.capture.region',
      captureArgs: args,
      prompt: args.prompt,
      traceId: context.trace_id || null
    }),
    'desktop.inspect.window': async (args = {}, context = {}) => inspectViaCapture({
      captureMethod: 'desktop.capture.window',
      captureArgs: args,
      prompt: args.prompt,
      traceId: context.trace_id || null
    })
  };
}

const adapters = createDesktopVisionAdapters();

module.exports = {
  ...adapters,
  __internal: {
    DEFAULT_INSPECT_SYSTEM_PROMPT,
    normalizePrompt,
    normalizeCaptureRecord,
    readCaptureAsDataUrl,
    buildInspectMessages,
    sanitizeCaptureArgs,
    normalizeInspectError,
    extractFinalAnalysis,
    createDesktopVisionAdapters
  }
};
