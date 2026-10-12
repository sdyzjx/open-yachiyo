package com.yachiyo.companion.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.HubState
import org.json.JSONObject

/** Reports mic state/level to whoever started the capture (the Web layer through the bridge). */
interface MicSink {
    fun micState(state: String, streamId: String? = null, error: String? = null)
    fun micLevel(rms: Double)
}

/** AudioRecord capture -> AudioPipeline -> Device Hub `audio.input.*` (contract C1.7). */
class MicController(private val hub: HubClient) {
    private var thread: Thread? = null
    @Volatile private var pipeline: AudioPipeline? = null
    @Volatile private var running = false
    private var counter = 0

    val isRunning: Boolean get() = running

    @Synchronized
    @Suppress("MissingPermission")
    fun start(mode: String, sink: MicSink, deviceId: String, modelRef: String? = null, audioMode: String = "transcribe"): String? {
        if (running) return "already recording"
        if (hub.state != HubState.CONNECTED) return "hub not connected"
        val min = AudioRecord.getMinBufferSize(Pcm.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return "audio unsupported"
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.MIC, Pcm.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min, Pcm.CHUNK_BYTES * 4))
        } catch (e: Exception) { return "AudioRecord: ${e.message}" }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return "AudioRecord not initialized" }

        val out = object : PipelineOut {
            override fun onStart(streamId: String, mode: String) {
                hub.publish("audio.input.start", JSONObject().put("stream_id", streamId).put("format", "pcm_s16le")
                    .put("sample_rate", Pcm.SAMPLE_RATE).put("channels", 1).put("mode", mode).put("lang", "auto")
                    .put("audio_mode", audioMode).apply { if (!modelRef.isNullOrBlank()) put("model_ref", modelRef) })
                sink.micState("recording", streamId)
            }
            override fun onChunk(streamId: String, seq: Int, pcm: ByteArray) {
                hub.publish("audio.input.chunk", JSONObject().put("stream_id", streamId).put("seq", seq)
                    .put("data_b64", Base64.encodeToString(pcm, Base64.NO_WRAP)))
            }
            override fun onEnd(streamId: String, reason: String) {
                hub.publish("audio.input.end", JSONObject().put("stream_id", streamId).put("reason", reason))
                sink.micState(if (reason == "released") "uploading" else "idle", streamId)
            }
            override fun onLevel(rms: Double) = sink.micLevel(rms)
        }
        val p = AudioPipeline(mode, out, { "mic-${deviceId.takeLast(8)}-${System.currentTimeMillis()}-${counter++}" })
        pipeline = p
        running = true
        p.begin()
        if (mode != "push_to_talk") sink.micState("idle")
        thread = Thread({
            val frame = ByteArray(Pcm.SAMPLE_RATE / 20 * 2)  // 50 ms -> 20 Hz level updates
            try {
                rec.startRecording()
                while (running) {
                    val n = rec.read(frame, 0, frame.size)
                    if (n > 0) p.onFrame(frame, n) else if (n < 0) { Log.w(TAG, "read error $n"); break }
                }
            } catch (e: Exception) {
                Log.w(TAG, "capture failed: ${e.message}")
                sink.micState("error", error = e.message)
            } finally {
                try { rec.stop() } catch (_: Exception) {}
                rec.release()
                running = false
            }
        }, "mic-capture").also { it.start() }
        return null
    }

    @Synchronized
    fun stop(reason: String, sink: MicSink? = null) {
        val p = pipeline ?: return
        running = false
        try { thread?.join(500) } catch (_: InterruptedException) {}
        p.end(if (reason == "cancel") "cancel" else "released")
        pipeline = null
        sink?.micState("idle")
    }

    companion object { private const val TAG = "MicController" }
}
