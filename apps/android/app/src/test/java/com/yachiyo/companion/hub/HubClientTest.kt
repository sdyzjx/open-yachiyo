package com.yachiyo.companion.hub

import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Fake gateway implementing the C1 handshake over MockWebServer. */
class HubClientTest {
    private lateinit var server: MockWebServer
    private val received = LinkedBlockingQueue<Envelope>()
    private val sockets = CopyOnWriteArrayList<WebSocket>()
    private val connections = AtomicInteger(0)
    private var rejectToken = false
    private var heartbeatMs = 15000
    private var answerPing = true
    private var client: HubClient? = null

    @Before fun setUp() {
        server = MockWebServer()
        server.enqueue(wsResponse())
        server.start()
    }

    @After fun tearDown() { client?.shutdown(); sockets.forEach { runCatching { it.close(1000, "t") } }; try { server.shutdown() } catch (_: Exception) {} }

    private fun wsResponse() = MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) { sockets.add(webSocket); connections.incrementAndGet() }
        override fun onMessage(webSocket: WebSocket, text: String) {
            val e = Envelope.parse(text)!!
            received.add(e)
            when (e.type) {
                "hello" -> if (rejectToken) webSocket.close(1008, "bad token") else webSocket.send(
                    Envelope("welcome", data = JSONObject().put("device_id", e.data!!.getString("device_id"))
                        .put("heartbeat_ms", heartbeatMs).put("avatar_host", "desktop")).toJson())
                "ping" -> if (answerPing) webSocket.send(Envelope("pong").toJson())
            }
        }
    })

    private fun newClient(backoffMs: Long = 50): HubClient {
        val c = HubClient(
            configProvider = { HubConfig(server.hostName, server.port, "tok") },
            helloProvider = { JSONObject().put("device_id", "android-test").put("device_type", "android") },
            backoff = { backoffMs }
        )
        client = c
        return c
    }

    private fun awaitState(c: HubClient, s: HubState, ms: Long = 3000) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end && c.state != s) Thread.sleep(10)
        assertEquals(s, c.state)
    }

    private fun next(type: String, ms: Long = 3000): Envelope {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            val e = received.poll(50, TimeUnit.MILLISECONDS) ?: continue
            if (e.type == type) return e
        }
        fail("no $type frame"); throw IllegalStateException()
    }

    @Test fun helloWelcomeConnects() {
        val c = newClient(); c.connect()
        val hello = next("hello")
        assertEquals("android-test", hello.data!!.getString("device_id"))
        awaitState(c, HubState.CONNECTED)
        assertEquals("desktop", c.avatarHost)
        assertTrue(server.takeRequest().path!!.contains("token=tok"))
    }

    @Test fun badTokenIsUnauthorizedAndStops() {
        rejectToken = true
        val c = newClient(); c.connect()
        awaitState(c, HubState.UNAUTHORIZED)
        Thread.sleep(300)
        assertEquals(1, connections.get())
    }

    @Test fun heartbeatPingsSent() {
        heartbeatMs = 100
        val c = newClient(); c.connect()
        next("ping")
        next("ping")
    }

    @Test fun silentServerTriggersReconnect() {
        heartbeatMs = 60; answerPing = false
        server.enqueue(wsResponse())
        val c = newClient(); c.connect()
        val end = System.currentTimeMillis() + 4000
        while (connections.get() < 2 && System.currentTimeMillis() < end) Thread.sleep(20)
        assertTrue(connections.get() >= 2)
    }

    @Test fun subscriptionsAndRegistrationsReplayedAfterReconnect() {
        server.enqueue(wsResponse())
        val c = newClient(); c.connect()
        awaitState(c, HubState.CONNECTED)
        c.subscribe(listOf("avatar.*", "plugin.x.**"))
        c.register(org.json.JSONArray().put(JSONObject().put("name", "device.vibrate")))
        next("sub"); next("rpc.register")
        sockets[0].close(1001, "going away")   // server drops
        next("hello")
        val sub = next("sub")
        assertEquals(2, sub.data!!.getJSONArray("topics").length())
        val reg = next("rpc.register")
        assertEquals("device.vibrate", reg.data!!.getJSONArray("methods").getJSONObject(0).getString("name"))
        awaitState(c, HubState.CONNECTED)
    }

    @Test fun rpcRoundTripAndCorrelation() {
        val c = newClient(); c.connect(); awaitState(c, HubState.CONNECTED)
        val latch = CountDownLatch(1)
        var res: Any? = null
        c.rpc("state.get", JSONObject(), "desktop-x") { r, _ -> res = r; latch.countDown() }
        val req = next("rpc.req")
        assertEquals("state.get", req.data!!.getString("method"))
        assertEquals("desktop-x", req.data!!.getString("target"))
        sockets[0].send(Envelope("rpc.res", id = req.id, data = JSONObject().put("result", JSONObject().put("ok", true))).toJson())
        assertTrue(latch.await(2, TimeUnit.SECONDS))
        assertTrue((res as JSONObject).getBoolean("ok"))
    }

    @Test fun rpcTimeout() {
        val c = newClient(); c.connect(); awaitState(c, HubState.CONNECTED)
        val latch = CountDownLatch(1)
        var err: JSONObject? = null
        c.rpc("slow", JSONObject(), null, timeoutMs = 100) { _, e -> err = e; latch.countDown() }
        assertTrue(latch.await(2, TimeUnit.SECONDS))
        assertEquals(RpcCodes.TIMEOUT, err!!.getInt("code"))
    }

    @Test fun rpcWhenDisconnectedFailsFast() {
        val c = newClient()
        val latch = CountDownLatch(1)
        var err: JSONObject? = null
        c.rpc("x", JSONObject()) { _, e -> err = e; latch.countDown() }
        assertTrue(latch.await(1, TimeUnit.SECONDS))
        assertEquals(RpcCodes.TARGET_OFFLINE, err!!.getInt("code"))
    }

    @Test fun incomingRpcHandledLocally() {
        val c = newClient()
        c.registerLocal("device.ping") { p -> JSONObject().put("echo", p.optInt("n")) }
        c.connect(); awaitState(c, HubState.CONNECTED)
        sockets[0].send(Envelope("rpc.req", id = "r1", data = JSONObject().put("method", "device.ping").put("params", JSONObject().put("n", 7))).toJson())
        val res = next("rpc.res")
        assertEquals("r1", res.id)
        assertEquals(7, res.data!!.getJSONObject("result").getInt("echo"))
    }

    @Test fun incomingUnknownRpcWithoutListenersIsMethodNotFound() {
        val c = newClient(); c.connect(); awaitState(c, HubState.CONNECTED)
        sockets[0].send(Envelope("rpc.req", id = "r2", data = JSONObject().put("method", "nope")).toJson())
        assertEquals(RpcCodes.METHOD_NOT_FOUND, next("rpc.res").data!!.getJSONObject("error").getInt("code"))
    }

    @Test fun incomingRpcIsDeliveredOnlyToTheFirstClaimingSurface() {
        val c = newClient()
        val settingsCalls = AtomicInteger(0)
        val mainCalls = AtomicInteger(0)
        val duplicateCalls = AtomicInteger(0)
        c.addListener(object : HubListener {
            override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String): Boolean {
                settingsCalls.incrementAndGet()
                return false
            }
        })
        c.addListener(object : HubListener {
            override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String): Boolean {
                mainCalls.incrementAndGet()
                c.respond(id, JSONObject().put("surface", "main"), null)
                return true
            }
        })
        c.addListener(object : HubListener {
            override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String): Boolean {
                duplicateCalls.incrementAndGet()
                return true
            }
        })
        c.connect(); awaitState(c, HubState.CONNECTED)
        sockets[0].send(Envelope("rpc.req", id = "surface-1", data = JSONObject().put("method", "state.get")).toJson())
        val res = next("rpc.res")
        assertEquals("main", res.data!!.getJSONObject("result").getString("surface"))
        assertEquals(1, settingsCalls.get())
        assertEquals(1, mainCalls.get())
        assertEquals(0, duplicateCalls.get())
    }

    @Test fun unclaimedRpcWithListenersReturnsMethodNotFound() {
        val c = newClient()
        c.addListener(object : HubListener {
            override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String) = false
        })
        c.connect(); awaitState(c, HubState.CONNECTED)
        sockets[0].send(Envelope("rpc.req", id = "settings-only", data = JSONObject().put("method", "state.get")).toJson())
        assertEquals(RpcCodes.METHOD_NOT_FOUND, next("rpc.res").data!!.getJSONObject("error").getInt("code"))
    }

    @Test fun eventsDispatchedToListeners() {
        val c = newClient()
        val q = LinkedBlockingQueue<String>()
        c.addListener(object : HubListener { override fun onEvent(topic: String, data: JSONObject, from: String) { q.add("$topic|$from") } })
        c.connect(); awaitState(c, HubState.CONNECTED)
        sockets[0].send(Envelope("event", topic = "avatar.host.changed", from = "gateway", data = JSONObject().put("host", "android-test")).toJson())
        assertEquals("avatar.host.changed|gateway", q.poll(2, TimeUnit.SECONDS))
        assertEquals("android-test", c.avatarHost)
    }

    @Test fun ipv6HostIsBracketedAndScopeEncoded() {
        assertEquals("ws://[2001:db8::2]:3000/ws/device", HubConfig("2001:db8::2", 3000, "").url())
        assertEquals("ws://[fe80::1%25wlan0]:3000/ws/device", HubConfig("fe80::1%wlan0", 3000, "").url())
    }
}
