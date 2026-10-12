package com.yachiyo.companion.bridge

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WebDispatcherTest {
    @Test fun queuesUntilReadyThenFlushesInOrder() {
        val out = ArrayList<String>()
        val d = WebDispatcher({ out.add(it) })
        d.post("a", JSONObject()); d.post("b", JSONObject())
        assertTrue(out.isEmpty())
        d.markReady()
        assertEquals(2, out.size)
        assertTrue(out[0].contains("\"type\":\"a\"")); assertTrue(out[1].contains("\"type\":\"b\""))
        d.post("c", JSONObject())
        assertEquals(3, out.size)
    }

    @Test fun notReadyQueuesAgain() {
        val out = ArrayList<String>()
        val d = WebDispatcher({ out.add(it) })
        d.markReady(); d.markNotReady(); d.post("x", JSONObject())
        assertTrue(out.isEmpty())
        d.markReady(); assertEquals(1, out.size)
    }

    @Test fun queueIsBounded() {
        val out = ArrayList<String>()
        val d = WebDispatcher({ out.add(it) }, maxQueue = 3)
        for (i in 0 until 10) d.post("t$i", JSONObject())
        d.markReady()
        assertEquals(3, out.size)
        assertTrue(out[0].contains("t7"))
    }

    @Test fun scriptFallsBackToGlobalQueueAndEscapesSeparators() {
        val s = WebDispatcher.buildScript("{\"a\":\"x y\"}")
        assertTrue(s.contains("__yachiyoQueue"))
        assertFalse(s.contains(" "))
        assertTrue(s.contains("\\u2028"))
    }
}
