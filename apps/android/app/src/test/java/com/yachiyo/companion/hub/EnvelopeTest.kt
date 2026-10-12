package com.yachiyo.companion.hub

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EnvelopeTest {
    @Test fun roundTrip() {
        val e = Envelope("pub", id = "1", topic = "a.b", data = JSONObject().put("x", 1), ts = 5)
        val p = Envelope.parse(e.toJson())!!
        assertEquals("pub", p.type); assertEquals("1", p.id); assertEquals("a.b", p.topic)
        assertEquals(1, p.data!!.getInt("x")); assertEquals(1, p.v)
    }

    @Test fun parseRejectsGarbage() {
        assertNull(Envelope.parse("not json"))
        assertNull(Envelope.parse("""{"data":{}}"""))
    }

    @Test fun optionalFieldsAbsent() {
        val p = Envelope.parse("""{"v":1,"type":"ping"}""")!!
        assertNull(p.id); assertNull(p.topic); assertNull(p.data)
    }

    @Test fun backoffSequence() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L), (0..6).map { Backoff.delayMs(it) })
        assertEquals(30000L, Backoff.delayMs(500))
    }

    @Test fun hubConfigUrl() {
        assertEquals("ws://h:3000/ws/device?token=a+b", HubConfig("h", 3000, "a b").url())
        assertEquals("ws://h:3000/ws/device", HubConfig("h", 3000, "").url())
        assertEquals("wss://x.y/ws/device?token=t", HubConfig("wss://x.y/", 1, "t").url())
    }
}
