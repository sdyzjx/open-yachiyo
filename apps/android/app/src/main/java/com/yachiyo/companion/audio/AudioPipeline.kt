package com.yachiyo.companion.audio

import kotlin.math.sqrt

object Pcm {
    const val SAMPLE_RATE = 16000
    const val CHUNK_MS = 100
    /** 100 ms of 16 kHz mono PCM16 = 3200 bytes (contract C1.7). */
    const val CHUNK_BYTES = SAMPLE_RATE * CHUNK_MS / 1000 * 2

    /** RMS of little-endian PCM16 in [0,1]. */
    fun rms(buf: ByteArray, len: Int): Double {
        val n = len / 2
        if (n == 0) return 0.0
        var sum = 0.0
        for (i in 0 until n) {
            val s = (buf[2 * i].toInt() and 0xFF) or (buf[2 * i + 1].toInt() shl 8)  // sign via shl of signed byte
            val v = s.toShort().toInt() / 32768.0
            sum += v * v
        }
        return sqrt(sum / n)
    }

    fun frameMs(len: Int): Int = len / 2 * 1000 / SAMPLE_RATE
}

/** Re-blocks arbitrary byte reads into fixed-size chunks. */
class PcmChunker(private val chunkBytes: Int = Pcm.CHUNK_BYTES, private val onChunk: (ByteArray) -> Unit) {
    private var buf = ByteArray(chunkBytes)
    private var fill = 0

    fun feed(data: ByteArray, len: Int) {
        var off = 0
        while (off < len) {
            val n = minOf(chunkBytes - fill, len - off)
            System.arraycopy(data, off, buf, fill, n)
            fill += n; off += n
            if (fill == chunkBytes) { onChunk(buf); buf = ByteArray(chunkBytes); fill = 0 }
        }
    }

    /** Emits the trailing partial chunk (if any). */
    fun flush() {
        if (fill > 0) { onChunk(buf.copyOf(fill)); buf = ByteArray(chunkBytes); fill = 0 }
    }
}

interface PipelineOut {
    fun onStart(streamId: String, mode: String)
    fun onChunk(streamId: String, seq: Int, pcm: ByteArray)
    fun onEnd(streamId: String, reason: String)
    fun onLevel(rms: Double)
}

/**
 * Turns PCM frames into audio.input streams.
 * - push_to_talk: [begin]/[end] delimit one stream.
 * - continuous: a simple energy VAD opens a stream on speech and closes it after
 *   [silenceMs] of silence (reason "vad"); a 300 ms pre-roll keeps the first syllable.
 */
class AudioPipeline(
    val mode: String,
    private val out: PipelineOut,
    private val newStreamId: () -> String,
    private val silenceMs: Int = 800,
    private val prerollMs: Int = 300,
    private val maxSegmentMs: Int = 30000,
    private val minSpeechMs: Int = 150,
    private val baseThreshold: Double = 0.015
) {
    private var streamId: String? = null
    private var seq = 0
    private var chunker: PcmChunker? = null
    private val preroll = ArrayDeque<ByteArray>()
    private var prerollTotalMs = 0
    private var speechRun = 0
    private var silentMs = 0
    private var segmentMs = 0
    private var speechMs = 0
    private var noiseFloor = 0.005
    private var started = false

    val active: Boolean get() = streamId != null

    fun begin() {
        started = true
        if (mode == "push_to_talk") openStream()
    }

    private fun openStream() {
        val id = newStreamId()
        streamId = id; seq = 0; silentMs = 0; segmentMs = 0; speechMs = 0
        chunker = PcmChunker { c -> out.onChunk(id, seq++, c) }
        out.onStart(id, mode)
    }

    fun onFrame(data: ByteArray, len: Int) {
        if (!started) return
        val rms = Pcm.rms(data, len)
        out.onLevel(rms.coerceIn(0.0, 1.0))
        val ms = Pcm.frameMs(len)
        if (mode == "push_to_talk") { chunker?.feed(data, len); return }

        val threshold = maxOf(baseThreshold, noiseFloor * 3)
        val loud = rms > threshold
        if (!active) {
            if (!loud) noiseFloor = noiseFloor * 0.95 + rms * 0.05
            val copy = data.copyOf(len)
            preroll.addLast(copy); prerollTotalMs += ms
            while (prerollTotalMs > prerollMs && preroll.size > 1) prerollTotalMs -= Pcm.frameMs(preroll.removeFirst().size)
            speechRun = if (loud) speechRun + ms else 0
            if (speechRun >= 100) {
                openStream()
                preroll.forEach { chunker!!.feed(it, it.size) }
                segmentMs = prerollTotalMs; speechMs = speechRun
                preroll.clear(); prerollTotalMs = 0; speechRun = 0
            }
            return
        }
        chunker!!.feed(data, len)
        segmentMs += ms
        if (loud) { silentMs = 0; speechMs += ms } else silentMs += ms
        if (silentMs >= silenceMs || segmentMs >= maxSegmentMs) closeStream(if (speechMs >= minSpeechMs) "vad" else "cancel")
    }

    private fun closeStream(reason: String) {
        val id = streamId ?: return
        if (reason != "cancel") chunker?.flush()
        streamId = null; chunker = null
        out.onEnd(id, reason)
    }

    /** reason: released | vad | cancel. Ends the session; any open stream is closed. */
    fun end(reason: String) {
        started = false
        closeStream(reason)
        preroll.clear(); prerollTotalMs = 0
    }
}
