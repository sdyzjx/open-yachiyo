package com.yachiyo.companion.plugins

import org.junit.Assert.*
import org.junit.Test

class PushPolicyTest {
    @Test fun onlyGatewayOrRuntimeTrusted() {
        assertTrue(PushPolicy.trustedSender("gateway")); assertTrue(PushPolicy.trustedSender("runtime"))
        assertFalse(PushPolicy.trustedSender("android-1234")); assertFalse(PushPolicy.trustedSender("")); assertFalse(PushPolicy.trustedSender("plugin.x"))
    }

    @Test fun relativeResolvesAgainstServer() {
        assertEquals("http://10.0.0.5:3000/api/p/blob", PushPolicy.resolveUrl("/api/p/blob", "10.0.0.5", 3000))
        assertEquals("http://10.0.0.5:3000/api/p", PushPolicy.resolveUrl("api/p", "10.0.0.5", 3000))
    }

    @Test fun sameServerAbsoluteAccepted() {
        assertEquals("http://10.0.0.5:3000/a", PushPolicy.resolveUrl("http://10.0.0.5:3000/a", "10.0.0.5", 3000))
    }

    @Test fun foreignAbsoluteRejected() {
        for (u in listOf("http://evil.com/a", "http://10.0.0.5:3001/a", "https://10.0.0.5:3000/a", "//evil.com/a", "http://10.0.0.5.evil.com:3000/a", "http://user@evil.com:3000/a"))
            try { PushPolicy.resolveUrl(u, "10.0.0.5", 3000); fail(u) }
            catch (e: PluginException) { assertTrue(e.message!!.startsWith("foreign_url")) }
    }
}
