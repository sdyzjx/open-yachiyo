const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { QwenTtsClient } = require('../../desktop-live2d/main/voice/qwenTtsClient');

function attachVoiceRelay({ hub, bus, directory, ttsClient = new QwenTtsClient(), ttlMs = 600000, now = Date.now }) {
  fs.mkdirSync(directory, { recursive: true });
  const media = new Map();
  const requests = new Map();
  let stopped = false;
  const cleanup = () => {
    for (const [id, entry] of media) {
      if (entry.expires <= now()) { fs.rmSync(entry.file, { force: true }); media.delete(id); }
    }
    for (const [id, expiry] of requests) if (expiry <= now()) requests.delete(id);
    for (const file of fs.readdirSync(directory)) {
      if (/^[\w-]+\.audio$/.test(file) && now() - fs.statSync(path.join(directory, file)).mtimeMs >= ttlMs) fs.rmSync(path.join(directory, file), { force: true });
    }
  };
  const timer = setInterval(cleanup, Math.min(ttlMs, 60000)); timer.unref();
  const handle = async (data) => {
    if (hub.getAvatarHost() === 'desktop') return;
    const device = hub.resolveDevice(hub.getAvatarHost());
    if (!device || device.device_type === 'desktop' || !String(data.text || '').trim()) return;
    const requestId = String(data.request_id || randomUUID());
    cleanup();
    if (requests.has(requestId)) return;
    requests.set(requestId, now() + ttlMs);
    if (requests.size > 512) requests.delete(requests.keys().next().value);
    try {
      const timeoutMs = Math.max(1000, Math.min(120000, Number(data.timeoutSec || 45) * 1000));
      const result = await ttsClient.synthesizeNonStreaming({ text: data.text, model: data.model, voice: data.voiceId, timeoutMs });
      const buffer = await ttsClient.fetchAudioBuffer({ audioUrl: result.audioUrl, timeoutMs });
      if (buffer.length > 20 * 1024 * 1024) throw new Error('TTS audio exceeds 20 MiB');
      if (stopped || !hub.isHost(device)) return; // Do not replay a stale utterance on a new host.
      const id = randomUUID();
      const file = path.join(directory, `${id}.audio`);
      fs.writeFileSync(file, buffer, { mode: 0o600 });
      media.set(id, { file, mime: result.mimeType || 'audio/wav', expires: now() + ttlMs });
      const url = new URL(`/api/device/media/${id}`, device.ws.baseUrl);
      url.searchParams.set('token', hub.token);
      hub.publish('voice.play', { request_id: requestId, url: url.toString(), mime: result.mimeType || 'audio/wav', text: data.text, session_id: data.session_id }, { target: device.device_id, direct: true });
    } catch (err) {
      if (!stopped && hub.isHost(device)) hub.publish('voice.stream.error', { request_id: requestId, error: 'TTS synthesis failed' }, { target: device.device_id, direct: true });
    }
  };
  const off = bus.subscribe('voice.requested', (data) => { void handle(data); });
  const receipt = ({ topic, data, device }) => {
    if (/^voice\.playback\.(started|ended)$/.test(topic) && hub.isHost(device)) bus.publish(topic, { ...data, __from_device: device.device_id });
  };
  hub.on('publication', receipt);
  hub.once('shutdown', () => { stopped = true; off(); clearInterval(timer); hub.off('publication', receipt); });
  hub.voiceRelay = { handle, cleanup, get(id) { cleanup(); return media.get(id); } };
  return hub.voiceRelay;
}
module.exports = { attachVoiceRelay };
