const fs = require('node:fs');
const path = require('node:path');
const { fault } = require('./hub');
const { createAsrService } = require('./asrService');

function pcmToWav(pcm, sampleRate = 16000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function attachAudioInput({ hub, directory, transcribe = createAsrService(), maxBytes = 16000 * 2 * 120, streamTimeoutMs = 130000 }) {
  fs.mkdirSync(directory, { recursive: true });
  const streams = new Map();
  const busy = new Set();
  let stopped = false;
  const clear = (device) => {
    const stream = streams.get(device);
    if (stream) clearTimeout(stream.timer);
    streams.delete(device);
    return stream;
  };
  const transcript = (device, streamId, text, error) => hub.publish('audio.input.transcript', { stream_id: streamId, text, final: true, ...(error ? { error } : {}) }, { target: device.device_id, direct: true });
  const handle = async ({ topic, data, device }) => {
    if (!topic.startsWith('audio.input.')) return;
    try {
      if (!/^[\w-]{1,128}$/.test(data.stream_id || '')) throw fault(-32602, 'Invalid stream id');
      if (topic === 'audio.input.start') {
        if (busy.has(device) || streams.has(device)) throw fault(-32600, 'Audio stream already active');
        if (data.format !== 'pcm_s16le' || data.sample_rate !== 16000 || data.channels !== 1 || !['push_to_talk', 'continuous'].includes(data.mode) || !['auto', 'zh', 'en'].includes(data.lang || 'auto')) throw fault(-32602, 'Expected 16 kHz mono PCM s16le');
        const stream = { ...data, chunks: [], bytes: 0, nextSeq: 0 };
        stream.timer = setTimeout(() => { clear(device); transcript(device, data.stream_id, '', { code: -32003, message: 'Audio stream timeout' }); }, streamTimeoutMs);
        streams.set(device, stream);
      } else {
        const stream = streams.get(device);
        if (!stream || stream.stream_id !== data.stream_id) throw fault(-32602, 'Unknown audio stream');
        if (topic === 'audio.input.chunk') {
          if (!Number.isInteger(data.seq) || data.seq !== stream.nextSeq || typeof data.data_b64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.data_b64)) throw fault(-32602, 'Invalid audio chunk/sequence');
          const chunk = Buffer.from(data.data_b64, 'base64');
          if (!chunk.length || chunk.length % 2 || stream.bytes + chunk.length > maxBytes) throw fault(-32602, 'Audio size invalid or recording limit exceeded');
          stream.chunks.push(chunk); stream.bytes += chunk.length; stream.nextSeq++;
        } else if (topic === 'audio.input.end') {
          if (!['released', 'vad', 'cancel'].includes(data.reason)) throw fault(-32602, 'Invalid end reason');
          clear(device);
          if (data.reason === 'cancel') return;
          if (!stream.bytes) throw fault(-32602, 'Empty recording');
          const wav = pcmToWav(Buffer.concat(stream.chunks));
          // Keep the contract's stream_id filename; refuse overwrites/cross-device collisions.
          const file = path.join(directory, `${stream.stream_id}.wav`);
          fs.writeFileSync(file, wav, { flag: 'wx', mode: 0o600 });
          busy.add(device);
          try {
            const result = await transcribe({ wav, file, lang: stream.lang || 'auto', device });
            if (stopped || hub.devices.get(device.device_id) !== device) return;
            transcript(device, stream.stream_id, result.text);
            await hub.runInput(device, { text: result.text, input_audio: { audio_ref: file, format: 'wav', lang: stream.lang || 'auto', transcribed_text: result.text } });
          } finally { busy.delete(device); }
        }
      }
    } catch (err) {
      clear(device);
      if (!stopped) transcript(device, data.stream_id, '', { code: typeof err.code === 'number' ? err.code : -32600, message: typeof err.code === 'number' ? err.message : 'Audio processing failed' });
    }
  };
  const listener = (event) => { void handle(event); };
  hub.on('publication', listener); hub.on('offline', clear);
  hub.once('shutdown', () => { stopped = true; hub.off('publication', listener); hub.off('offline', clear); for (const device of streams.keys()) clear(device); });
  return { handle, streams };
}
module.exports = { pcmToWav, attachAudioInput };
