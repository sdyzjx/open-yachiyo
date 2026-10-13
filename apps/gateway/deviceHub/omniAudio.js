function contentText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('').trim();
  return '';
}

function configurationError(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}

// Audio transport only: prompts, history, tools and approvals remain in Pi.
function createOmniAudioService({
  llmManager,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 120000
}) {
  const resolve = (modelRef, mode) => {
    const descriptor = llmManager.getCatalog().resolve(modelRef);
    if (!descriptor) throw configurationError(`Unknown model_ref: ${modelRef}`);
    if (!descriptor.input.includes('audio')) throw configurationError(`Model ${modelRef} does not accept audio`);
    if (mode === 'realtime' && descriptor.transport !== 'realtime') throw configurationError(`Model ${modelRef} is not a realtime model`);
    if (mode === 'direct' && descriptor.transport === 'realtime') throw configurationError(`Model ${modelRef} requires realtime audio`);
    if (!descriptor.api_key) throw configurationError(`No API key for provider ${descriptor.provider}`);
    return descriptor;
  };

  async function transcribe({ wav, modelRef }) {
    const descriptor = resolve(modelRef, 'direct');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, descriptor.timeout_ms || timeoutMs));
    try {
      const response = await fetchImpl(`${descriptor.base_url}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${descriptor.api_key}`, ...descriptor.headers },
        body: JSON.stringify({
          model: descriptor.id,
          messages: [{ role: 'user', content: [
            { type: 'text', text: 'Transcribe the spoken request exactly. Return only the transcript, without labels or commentary.' },
            { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}`, format: 'wav' } }
          ] }],
          stream: false,
          ...(descriptor.extra_body || {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Omni audio request failed (${response.status}): ${String(payload?.error?.message || '').slice(0, 240)}`);
      const text = contentText(payload);
      if (!text) throw new Error('Omni audio request returned an empty transcript');
      return { text };
    } finally {
      clearTimeout(timer);
    }
  }

  return { resolve, transcribe };
}

module.exports = { configurationError, contentText, createOmniAudioService };
