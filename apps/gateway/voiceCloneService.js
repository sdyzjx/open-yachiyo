const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const process = require('node:process');

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_VOICE_CLONE_MODEL = 'qwen-voice-enrollment';
const DEFAULT_NORMAL_TARGET_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_REALTIME_TARGET_MODEL = 'qwen3-tts-vc-realtime-2026-01-15';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_DURATION_SEC = 60;
const MIN_DURATION_SEC = 3;
const MIN_SAMPLE_RATE = 24000;
const SUPPORTED_SUFFIXES = new Set(['.wav', '.mp3', '.m4a']);

class OnboardingError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function normalizeBaseUrl(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function getCustomizationEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith('/services/audio/tts/customization')) {
    return normalized;
  }
  return `${normalized}/services/audio/tts/customization`;
}

function mapMimeToSuffix(mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return '.wav';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return '.mp3';
  if (normalized === 'audio/mp4' || normalized === 'audio/x-m4a' || normalized === 'audio/m4a') return '.m4a';
  return '.mp3';
}

function resolveBundledBinary(binaryName) {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? `${binaryName}.exe` : binaryName;
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', fileName));
  }

  if (process.execPath) {
    candidates.push(path.join(path.dirname(process.execPath), 'resources', 'bin', fileName));
  }

  for (const candidate of candidates) {
    try {
      require('node:fs').accessSync(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return binaryName;
}

function parseAudioDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', 'audio_data_url must be a valid base64 data URL');
  }
  const mimeType = String(match[1] || '').trim().toLowerCase();
  const payload = match[2].replace(/\s+/g, '');
  const binary = Buffer.from(payload, 'base64');
  if (!binary.length) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', 'audio_data_url payload is empty');
  }
  if (binary.length > MAX_AUDIO_BYTES) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', `audio file too large: ${binary.length} bytes`);
  }
  return { mimeType, binary };
}

async function runBinary(file, args, { timeoutMs = 15000 } = {}) {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: timeoutMs });
    return String(stdout || '');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new OnboardingError('ONBOARDING_DEP_MISSING', `${file} is not available`);
    }
    throw err;
  }
}

async function getAudioMeta(filePath, ffprobePath) {
  const stdout = await runBinary(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);
  let parsed = {};
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', 'ffprobe output is not valid json');
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const audioStream = streams.find((item) => item && item.codec_type === 'audio');
  if (!audioStream) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', 'audio stream not found');
  }
  const durationSec = Number(parsed.format?.duration || audioStream.duration || 0);
  const sampleRate = Number(audioStream.sample_rate || 0);
  const channels = Number(audioStream.channels || 0);
  const sizeBytes = Number(parsed.format?.size || 0);
  return {
    durationSec,
    sampleRate,
    channels,
    sizeBytes,
    codec: String(audioStream.codec_name || '')
  };
}

function validateDurationAndSize(meta) {
  if (!Number.isFinite(meta.durationSec) || meta.durationSec <= 0) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', 'audio duration is invalid');
  }
  if (meta.durationSec < MIN_DURATION_SEC) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', `audio duration too short: ${meta.durationSec.toFixed(2)}s`);
  }
  if (meta.durationSec > MAX_DURATION_SEC) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', `audio duration too long: ${meta.durationSec.toFixed(2)}s`);
  }
  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0 || meta.sizeBytes > MAX_AUDIO_BYTES) {
    throw new OnboardingError('ONBOARDING_AUDIO_INVALID', `audio file size is invalid: ${meta.sizeBytes}`);
  }
}

function needsNormalization(meta, suffix) {
  if (!SUPPORTED_SUFFIXES.has(suffix)) return true;
  if (meta.sampleRate < MIN_SAMPLE_RATE) return true;
  if (meta.channels !== 1) return true;
  return false;
}

async function normalizeAudio({ sourcePath, outputPath, ffmpegPath }) {
  await runBinary(ffmpegPath, [
    '-y',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '24000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    outputPath
  ], { timeoutMs: 40000 });
}

async function postDashscopeJson({ endpoint, apiKey, payload, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const bodyMessage = data?.message || data?.error?.message || text || `http ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        throw new OnboardingError('ONBOARDING_DASHSCOPE_AUTH_FAILED', bodyMessage, { status: response.status });
      }
      throw new OnboardingError('ONBOARDING_DASHSCOPE_PROVIDER_DOWN', bodyMessage, { status: response.status });
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new OnboardingError('ONBOARDING_DASHSCOPE_TIMEOUT', 'dashscope request timeout');
    }
    if (err instanceof OnboardingError) throw err;
    throw new OnboardingError('ONBOARDING_DASHSCOPE_PROVIDER_DOWN', err.message || String(err));
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlForDashscope(binary, mimeType) {
  const base64 = binary.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

async function cloneVoice({
  apiKey,
  audioDataUrl,
  preferredName = '',
  baseUrl = DEFAULT_BASE_URL,
  targetMode = 'normal',
  ffmpegPath = process.env.FFMPEG_PATH || resolveBundledBinary('ffmpeg'),
  ffprobePath = process.env.FFPROBE_PATH || resolveBundledBinary('ffprobe')
}) {
  const resolvedApiKey = String(apiKey || '').trim();
  if (!resolvedApiKey) {
    throw new OnboardingError('ONBOARDING_DASHSCOPE_AUTH_FAILED', 'api key is required');
  }

  const targetModel = targetMode === 'realtime'
    ? DEFAULT_REALTIME_TARGET_MODEL
    : DEFAULT_NORMAL_TARGET_MODEL;
  const customEndpoint = getCustomizationEndpoint(baseUrl);
  const parsedAudio = parseAudioDataUrl(audioDataUrl);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yachiyo-onboarding-voice-'));
  const tempInputPath = path.join(tempDir, `input-${Date.now()}${mapMimeToSuffix(parsedAudio.mimeType)}`);
  const tempNormalizedPath = path.join(tempDir, 'normalized.mp3');
  let sourceForUploadPath = tempInputPath;

  try {
    const { mimeType, binary } = parsedAudio;
    await fs.writeFile(tempInputPath, binary);
    const originalMeta = await getAudioMeta(tempInputPath, ffprobePath);
    validateDurationAndSize(originalMeta);

    if (needsNormalization(originalMeta, path.extname(tempInputPath).toLowerCase())) {
      await normalizeAudio({
        sourcePath: tempInputPath,
        outputPath: tempNormalizedPath,
        ffmpegPath
      });
      sourceForUploadPath = tempNormalizedPath;
      const normalizedMeta = await getAudioMeta(tempNormalizedPath, ffprobePath);
      validateDurationAndSize(normalizedMeta);
    }

    const finalBinary = await fs.readFile(sourceForUploadPath);
    const finalMimeType = sourceForUploadPath === tempNormalizedPath ? 'audio/mpeg' : (mimeType || 'audio/mpeg');
    const audioDataForUpload = dataUrlForDashscope(finalBinary, finalMimeType);
    const sanitizedPreferredName = String(preferredName || '').trim()
      || `yachiyo-${targetMode}-${createHash('md5').update(finalBinary).digest('hex').slice(0, 8)}`;

    const createPayload = {
      model: DEFAULT_VOICE_CLONE_MODEL,
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: sanitizedPreferredName,
        audio: { data: audioDataForUpload }
      }
    };
    const createResult = await postDashscopeJson({
      endpoint: customEndpoint,
      apiKey: resolvedApiKey,
      payload: createPayload
    });
    const voiceId = String(createResult?.output?.voice || '').trim();
    if (!voiceId) {
      throw new OnboardingError('ONBOARDING_DASHSCOPE_PROVIDER_DOWN', 'create response missing output.voice');
    }

    return {
      ok: true,
      voiceId,
      targetModel,
      endpoint: customEndpoint,
      preferredName: sanitizedPreferredName
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function inspectVoiceCloneDependencies({
  ffmpegPath = process.env.FFMPEG_PATH || resolveBundledBinary('ffmpeg'),
  ffprobePath = process.env.FFPROBE_PATH || resolveBundledBinary('ffprobe')
} = {}) {
  const snapshot = {
    ffmpeg: { ok: false, path: ffmpegPath, error: null },
    ffprobe: { ok: false, path: ffprobePath, error: null }
  };
  try {
    await runBinary(ffmpegPath, ['-version']);
    snapshot.ffmpeg.ok = true;
  } catch (err) {
    snapshot.ffmpeg.error = err.message || String(err);
  }
  try {
    await runBinary(ffprobePath, ['-version']);
    snapshot.ffprobe.ok = true;
  } catch (err) {
    snapshot.ffprobe.error = err.message || String(err);
  }
  return snapshot;
}

module.exports = {
  OnboardingError,
  DEFAULT_BASE_URL,
  DEFAULT_NORMAL_TARGET_MODEL,
  DEFAULT_REALTIME_TARGET_MODEL,
  cloneVoice,
  inspectVoiceCloneDependencies
};
