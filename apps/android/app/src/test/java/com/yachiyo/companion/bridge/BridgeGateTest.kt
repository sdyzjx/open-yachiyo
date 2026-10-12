package com.yachiyo.companion.bridge

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BridgeGateTest {
    private val warnings = ArrayList<String>()
    private fun gate() = BridgeGate({ m, a -> when (m) { "echo" -> a.optString(0); "boom" -> throw IllegalStateException("x"); else -> null } },
        warn = { warnings.add(it) })

    private fun code(r: String) = JSONObject(r).getJSONObject("error").getInt("code")

    @Test fun handshakeOnlyFirstCallReturnsToken() {
        val g = gate()
        val t = g.handshake()
        assertEquals(64, t.length); assertTrue(t.matches(Regex("[0-9a-f]{64}")))
        assertEquals("", g.handshake()); assertEquals("", g.handshake())
        assertEquals(2, warnings.size)
    }

    @Test fun resetIssuesFreshTokenAndInvalidatesOld() {
        val g = gate()
        val t1 = g.handshake()
        g.reset()
        assertEquals(-32006, code(g.invoke(t1, "echo", "[\"a\"]")))   // old token dead after page start
        val t2 = g.handshake()
        assertNotEquals(t1, t2)
        assertEquals("a", g.invoke(t2, "echo", "[\"a\"]"))
    }

    @Test fun mismatchAndNoHandshakeRejected() {
        val g = gate()
        assertEquals(-32006, code(g.invoke("", "echo", "[]")))        // before handshake
        g.handshake()
        assertEquals(-32006, code(g.invoke("0".repeat(64), "echo", "[]")))
        assertEquals(-32006, code(g.invoke("", "echo", "[]")))
    }

    @Test fun dispatchByNameWithArgsAndErrors() {
        val g = gate(); val t = g.handshake()
        assertEquals("hi", g.invoke(t, "echo", JSONArray().put("hi").toString()))
        assertEquals(-32601, code(g.invoke(t, "nope", "[]")))
        assertEquals(-32602, code(g.invoke(t, "echo", "not json")))
        assertEquals(-32603, code(g.invoke(t, "boom", "[]")))
    }
}
