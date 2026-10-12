package com.yachiyo.companion.discovery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class ServerDiscoveryTest {
    private val validTxt = mapOf(
        "version" to "1".toByteArray(),
        "path" to "/ws/device".toByteArray()
    )

    @Test fun acceptsContractTxtAndPrefersIpv4() {
        val candidate = DiscoveryCandidate.from(
            "Yachiyo on studio",
            3000,
            validTxt,
            listOf(InetAddress.getByName("2001:db8::2"), InetAddress.getByName("192.168.20.212"))
        )!!
        assertEquals("Yachiyo on studio", candidate.id)
        assertEquals("192.168.20.212", candidate.host)
        assertEquals(3000, candidate.port)
    }

    @Test fun acceptsIpv6WithoutUrlBrackets() {
        val candidate = DiscoveryCandidate.from(
            "Yachiyo v6",
            3000,
            validTxt,
            listOf(InetAddress.getByName("2001:db8::2"))
        )!!
        assertTrue(candidate.host.contains(':'))
        assertTrue(!candidate.host.startsWith('['))
    }

    @Test fun rejectsUnexpectedTxtAndInvalidPorts() {
        assertNull(DiscoveryCandidate.from("old", 3000, validTxt + ("version" to "2".toByteArray()), listOf(InetAddress.getLoopbackAddress())))
        assertNull(DiscoveryCandidate.from("wrong path", 3000, validTxt + ("path" to "/ws".toByteArray()), listOf(InetAddress.getLoopbackAddress())))
        assertNull(DiscoveryCandidate.from("bad port", 0, validTxt, listOf(InetAddress.getLoopbackAddress())))
    }

    @Test fun discoverySessionStartsOnceAndReturnsListenerForCleanup() {
        val session = DiscoverySession<String>()
        val first = session.start { "listener-$it" }!!

        assertTrue(session.scanning)
        assertNull(session.start { "duplicate-$it" })
        assertEquals("listener-${first.first}", session.cancel())
        assertTrue(!session.scanning)
        assertNull(session.listener)
    }

    @Test fun discoverySessionInvalidatesLateCallbacksBeforeRestart() {
        val session = DiscoverySession<String>()
        val firstGeneration = session.start { "first" }!!.first
        session.cancel()

        assertTrue(!session.active(firstGeneration))
        val secondGeneration = session.start { "second" }!!.first
        assertTrue(secondGeneration > firstGeneration)
        assertTrue(session.active(secondGeneration))
        assertTrue(!session.active(firstGeneration))
    }
}
