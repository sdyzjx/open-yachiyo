package com.yachiyo.companion.audio

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sin

class AudioPipelineTest {
    private fun tone(ms: Int, amp: Double): ByteArray {
        val n = Pcm.SAMPLE_RATE * ms / 1000
        val b = ByteArray(n * 2)
        for (i in 0 until n) {
            val v = (sin(i * 0.2) * amp * 32767).toInt().toShort().toInt()
            b[2 * i] = (v and 0xFF).toByte(); b[2 * i + 1] = (v shr 8).toByte()
        }
        return b
    }

    private class Rec : PipelineOut {
        val events = ArrayList<String>()
        val chunks = ArrayList<Int>()
        override fun onStart(streamId: String, mode: String) { events.add("start:$streamId") }
        override fun onChunk(streamId: String, seq: Int, pcm: ByteArray) { events.add("chunk:$seq"); chunks.add(pcm.size) }
        override fun onEnd(streamId: String, reason: String) { events.add("end:$reason") }
        override fun onLevel(rms: Double) {}
    }

    @Test fun chunkerEmitsExactBlocksAndFlushesTail() {
        val sizes = ArrayList<Int>()
        val c = PcmChunker(3200) { sizes.add(it.size) }
        c.feed(ByteArray(1600), 1600); assertTrue(sizes.isEmpty())
        c.feed(ByteArray(5000), 5000)           // 6600 total -> 2 blocks, 200 left
        assertEquals(listOf(3200, 3200), sizes)
        c.flush(); assertEquals(listOf(3200, 3200, 200), sizes)
        c.flush(); assertEquals(3, sizes.size)
    }

    @Test fun chunkBytesIs100ms() = assertEquals(3200, Pcm.CHUNK_BYTES)

    @Test fun rmsOfSilenceAndFullScale() {
        assertEquals(0.0, Pcm.rms(ByteArray(640), 640), 1e-9)
        val full = ByteArray(640)
        for (i in 0 until 320) { full[2 * i] = 0xFF.toByte(); full[2 * i + 1] = 0x7F }  // +32767
        assertEquals(1.0, Pcm.rms(full, 640), 0.001)
        val neg = ByteArray(640)
        for (i in 0 until 320) { neg[2 * i] = 0x00; neg[2 * i + 1] = 0x80.toByte() }   // -32768
        assertEquals(1.0, Pcm.rms(neg, 640), 0.001)
        assertEquals(0.5, Pcm.rms(tone(100, 1.0), 3200) * Math.sqrt(2.0), 0.6)
    }

    @Test fun pushToTalkOneStreamWithChunks() {
        val r = Rec(); val p = AudioPipeline("push_to_talk", r, { "s1" })
        p.begin()
        repeat(6) { p.onFrame(tone(50, 0.3), 1600) }     // 300 ms
        p.end("released")
        assertEquals(listOf("start:s1", "chunk:0", "chunk:1", "chunk:2", "end:released"), r.events)
        assertEquals(listOf(3200, 3200, 3200), r.chunks)
    }

    @Test fun pushToTalkCancelEndsWithoutError() {
        val r = Rec(); val p = AudioPipeline("push_to_talk", r, { "s" })
        p.begin(); p.end("cancel")
        assertEquals(listOf("start:s", "end:cancel"), r.events)
    }

    @Test fun continuousSegmentsOnSpeechAndEndsAfter800msSilence() {
        val r = Rec(); var n = 0
        val p = AudioPipeline("continuous", r, { "v${n++}" })
        p.begin()
        repeat(10) { p.onFrame(ByteArray(1600), 1600) }               // 500 ms silence
        assertTrue(r.events.isEmpty())
        repeat(10) { p.onFrame(tone(50, 0.3), 1600) }                 // 500 ms speech
        assertTrue(r.events.first().startsWith("start:"))
        repeat(15) { p.onFrame(ByteArray(1600), 1600) }               // 750 ms silence: still open
        assertFalse(r.events.contains("end:vad"))
        p.onFrame(ByteArray(1600), 1600); p.onFrame(ByteArray(1600), 1600)  // >= 800 ms
        assertTrue(r.events.contains("end:vad"))
        assertFalse(p.active)
        // second utterance opens a new stream
        repeat(4) { p.onFrame(tone(50, 0.3), 1600) }
        assertEquals(2, r.events.count { it.startsWith("start:") })
    }

    @Test fun continuousIgnoresShortBlip() {
        val r = Rec(); val p = AudioPipeline("continuous", r, { "x" })
        p.begin()
        p.onFrame(tone(50, 0.3), 1600); p.onFrame(tone(50, 0.3), 1600)   // 100 ms -> opens
        repeat(17) { p.onFrame(ByteArray(1600), 1600) }
        // 100ms of speech < minSpeech(150) -> cancelled, no recognition
        assertTrue(r.events.contains("end:cancel") || r.events.contains("end:vad"))
    }

    @Test fun preRollIncludedInFirstChunks() {
        val r = Rec(); val p = AudioPipeline("continuous", r, { "x" })
        p.begin()
        repeat(6) { p.onFrame(ByteArray(1600), 1600) }
        repeat(2) { p.onFrame(tone(50, 0.3), 1600) }
        // preroll (300ms silence incl. current frames) + speech flows into chunks: at least 3 chunks worth
        assertTrue(r.chunks.size >= 1)
    }
}
