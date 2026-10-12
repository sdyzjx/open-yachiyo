package com.yachiyo.companion.hub

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

enum class HubState(val wire: String) {
    DISCONNECTED("disconnected"), CONNECTING("connecting"), CONNECTED("connected"), UNAUTHORIZED("unauthorized")
}

data class HubConfig(val host: String, val port: Int, val token: String) {
    fun url(): String {
        val h = host.trim()
        val base = if (h.startsWith("ws://") || h.startsWith("wss://")) h.trimEnd('/') else "ws://${hostForUrl(h)}:$port"
        val sep = "/ws/device"
        val tokenPart = if (token.isNotEmpty()) "?token=" + java.net.URLEncoder.encode(token, "UTF-8") else ""
        return base + sep + tokenPart
    }

    companion object {
        /** DNS-SD reports IPv6 literals without URL brackets; encode scope ids for URI parsing. */
        fun hostForUrl(host: String): String {
            val h = host.trim().removePrefix("[").removeSuffix("]")
            if (!h.contains(':')) return h
            return "[${h.replace("%", "%25")}]"
        }
    }
}

interface HubListener {
    fun onState(state: HubState) {}
    fun onEvent(topic: String, data: JSONObject, from: String) {}
    /** Returns true only when this listener claimed the request and will eventually call respond(). */
    fun onRpcRequest(id: String, method: String, params: JSONObject, from: String): Boolean = false
}

typealias LocalRpcHandler = (params: JSONObject) -> Any?

/**
 * WebSocket client for the gateway Device Hub (contract C1). Thread-safe; all callbacks arrive on
 * internal executor threads.
 */
class HubClient(
    private val configProvider: () -> HubConfig,
    private val helloProvider: () -> JSONObject,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(0, TimeUnit.SECONDS).build(),
    private val defaultHeartbeatMs: Long = 15000L,
    private val backoff: (Int) -> Long = Backoff::delayMs
) {
    private val exec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "hub-client").apply { isDaemon = true } }
    private val listeners = CopyOnWriteArrayList<HubListener>()
    private val localHandlers = ConcurrentHashMap<String, LocalRpcHandler>()

    // subscription + registration tables, replayed after every (re)connect
    private val subscriptions = LinkedHashSet<String>()
    private val registered = LinkedHashMap<String, JSONObject>()

    private class Pending(val callback: (Any?, JSONObject?) -> Unit, val timeout: ScheduledFuture<*>)
    private val pending = ConcurrentHashMap<String, Pending>()

    @Volatile var state: HubState = HubState.DISCONNECTED; private set
    @Volatile var avatarHost: String = ""; private set
    @Volatile var devices: JSONArray = JSONArray(); private set
    @Volatile var lastUrl: String = ""; private set
    @Volatile var sessionId: String = ""; private set
    @Volatile var currentMode: String = "normal"

    private var socket: WebSocket? = null
    private var wantConnected = false
    private var attempt = 0
    private var heartbeatMs = defaultHeartbeatMs
    private var heartbeatTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    @Volatile private var lastRx = 0L
    private var generation = 0

    private fun post(block: () -> Unit) {
        try { exec.execute(block) } catch (_: java.util.concurrent.RejectedExecutionException) {}
    }

    fun addListener(l: HubListener) { listeners.add(l) }
    fun removeListener(l: HubListener) { listeners.remove(l) }
    fun registerLocal(name: String, handler: LocalRpcHandler) { localHandlers[name] = handler }

    // ---- lifecycle -----------------------------------------------------------------------

    fun connect() = post {
        wantConnected = true
        attempt = 0
        reconnectTask?.cancel(false)
        openSocket()
    }

    fun disconnect() = post {
        wantConnected = false
        reconnectTask?.cancel(false)
        heartbeatTask?.cancel(false)
        generation++
        socket?.close(1000, "bye")
        socket = null
        failAllPending("disconnected")
        setState(HubState.DISCONNECTED)
    }

    fun shutdown() { disconnect(); exec.shutdown() }

    private fun openSocket() {
        socket?.cancel()
        val gen = ++generation
        val cfg = configProvider()
        val url = cfg.url()
        lastUrl = url.substringBefore("?token=")
        setState(HubState.CONNECTING)
        val request = try { Request.Builder().url(url.replaceFirst("ws://", "http://").replaceFirst("wss://", "https://")).build() }
        catch (e: Exception) { Log.w(TAG, "bad url $url: ${e.message}"); setState(HubState.DISCONNECTED); return }
        socket = http.newWebSocket(request, Listener(gen))
    }

    private fun scheduleReconnect() {
        if (!wantConnected) return
        val delay = backoff(attempt++)
        Log.i(TAG, "reconnect in ${delay}ms (attempt $attempt)")
        reconnectTask?.cancel(false)
        reconnectTask = exec.schedule({ if (wantConnected) openSocket() }, delay, TimeUnit.MILLISECONDS)
    }

    private fun setState(s: HubState) {
        if (state == s) return
        state = s
        listeners.forEach { runCatching { it.onState(s) } }
    }

    // ---- sending -------------------------------------------------------------------------

    private fun send(env: Envelope): Boolean {
        val s = socket ?: return false
        if (state != HubState.CONNECTED && env.type != "hello") return false
        return s.send(env.toJson())
    }

    fun publish(topic: String, data: JSONObject = JSONObject()): Boolean = send(Envelope("pub", topic = topic, data = data))

    fun subscribe(patterns: List<String>) {
        post {
            subscriptions.addAll(patterns)
            send(Envelope("sub", data = JSONObject().put("topics", JSONArray(patterns))))
        }
    }

    fun unsubscribe(patterns: List<String>) {
        post {
            subscriptions.removeAll(patterns.toSet())
            send(Envelope("unsub", data = JSONObject().put("topics", JSONArray(patterns))))
        }
    }

    fun register(methods: JSONArray) {
        post {
            for (i in 0 until methods.length()) {
                val m = methods.optJSONObject(i) ?: continue
                registered[m.optString("name")] = m
            }
            send(Envelope("rpc.register", data = JSONObject().put("methods", methods)))
        }
    }

    fun unregister(names: List<String>) {
        post {
            names.forEach { registered.remove(it) }
            send(Envelope("rpc.unregister", data = JSONObject().put("methods", JSONArray(names))))
        }
    }

    /** Calls a remote method. [callback] gets (result, error) exactly once; timeout yields -32003. */
    fun rpc(
        method: String, params: JSONObject, target: String? = null, timeoutMs: Long = 8000L,
        callback: (result: Any?, error: JSONObject?) -> Unit
    ) {
        val id = UUID.randomUUID().toString()
        val timeout = exec.schedule({
            pending.remove(id)?.callback?.invoke(null, errorJson(RpcCodes.TIMEOUT, "rpc timeout: $method"))
        }, timeoutMs, TimeUnit.MILLISECONDS)
        pending[id] = Pending(callback, timeout)
        val data = JSONObject().put("method", method).put("params", params)
        if (!target.isNullOrEmpty()) data.put("target", target)
        if (!send(Envelope("rpc.req", id = id, data = data))) {
            pending.remove(id)?.let {
                it.timeout.cancel(false)
                it.callback(null, errorJson(RpcCodes.TARGET_OFFLINE, "hub not connected"))
            }
        }
    }

    fun respond(reqId: String, result: Any?, error: JSONObject?) {
        val data = JSONObject()
        if (error != null) data.put("error", error) else data.put("result", result ?: JSONObject.NULL)
        send(Envelope("rpc.res", id = reqId, data = data))
    }

    /** Updates mode locally and tells the hub (`pub sys.device.mode`). */
    fun setMode(mode: String) {
        currentMode = mode
        publish("sys.device.mode", JSONObject().put("mode", mode))
    }

    private fun failAllPending(reason: String) {
        val it = pending.entries.iterator()
        while (it.hasNext()) {
            val e = it.next(); it.remove()
            e.value.timeout.cancel(false)
            e.value.callback(null, errorJson(RpcCodes.TARGET_OFFLINE, reason))
        }
    }

    fun snapshotJson(): JSONObject = JSONObject()
        .put("state", state.wire)
        .put("url", lastUrl)
        .put("avatar_host", avatarHost)
        .put("devices", devices)

    // ---- receiving -----------------------------------------------------------------------

    private fun handleFrame(gen: Int, text: String) = post {
        if (gen != generation) return@post
        lastRx = System.currentTimeMillis()
        val env = Envelope.parse(text) ?: return@post
        val data = env.data ?: JSONObject()
        when (env.type) {
            "welcome" -> onWelcome(data)
            "ping" -> send(Envelope("pong"))
            "pong" -> {}
            "event" -> onEvent(env.topic ?: "", data, env.from ?: "")
            "rpc.req" -> onRpcReq(env, data)
            "rpc.res" -> {
                val p = env.id?.let { pending.remove(it) } ?: return@post
                p.timeout.cancel(false)
                if (data.has("error")) p.callback(null, data.optJSONObject("error") ?: errorJson(RpcCodes.INTERNAL, "error"))
                else p.callback(data.opt("result").takeUnless { it === JSONObject.NULL }, null)
            }
            "error" -> Log.w(TAG, "hub error: ${data}")
        }
    }

    private fun onWelcome(data: JSONObject) {
        attempt = 0
        heartbeatMs = data.optLong("heartbeat_ms", defaultHeartbeatMs).coerceAtLeast(20L)
        avatarHost = data.optString("avatar_host", "")
        devices = data.optJSONArray("devices") ?: JSONArray()
        sessionId = data.optString("session_id", "")
        setState(HubState.CONNECTED)
        startHeartbeat()
        if (subscriptions.isNotEmpty())
            send(Envelope("sub", data = JSONObject().put("topics", JSONArray(subscriptions.toList()))))
        if (registered.isNotEmpty())
            send(Envelope("rpc.register", data = JSONObject().put("methods", JSONArray(registered.values.toList()))))
    }

    private fun startHeartbeat() {
        heartbeatTask?.cancel(false)
        lastRx = System.currentTimeMillis()
        heartbeatTask = exec.scheduleAtFixedRate({
            if (System.currentTimeMillis() - lastRx > heartbeatMs * 2 + 50) {
                Log.w(TAG, "heartbeat timeout; dropping socket")
                socket?.cancel()
            } else send(Envelope("ping"))
        }, heartbeatMs, heartbeatMs, TimeUnit.MILLISECONDS)
    }

    private fun onEvent(topic: String, data: JSONObject, from: String) {
        when (topic) {
            "avatar.host.changed" -> avatarHost = data.optString("host", avatarHost)
            "sys.device.online" -> devices = JSONArray().also { arr ->
                for (i in 0 until devices.length()) {
                    val d = devices.optJSONObject(i)
                    if (d != null && d.optString("device_id") != data.optString("device_id")) arr.put(d)
                }
                arr.put(data)
            }
            "sys.device.offline" -> devices = JSONArray().also { arr ->
                for (i in 0 until devices.length()) {
                    val d = devices.optJSONObject(i)
                    if (d != null && d.optString("device_id") != data.optString("device_id")) arr.put(d)
                }
            }
        }
        listeners.forEach { runCatching { it.onEvent(topic, data, from) } }
    }

    private fun onRpcReq(env: Envelope, data: JSONObject) {
        val id = env.id ?: return
        val method = data.optString("method")
        val params = data.optJSONObject("params") ?: JSONObject()
        val handler = localHandlers[method]
        if (handler != null) {
            try {
                respond(id, handler(params), null)
            } catch (e: RpcException) {
                respond(id, null, errorJson(e.code, e.message ?: "error"))
            } catch (e: Exception) {
                respond(id, null, errorJson(RpcCodes.INTERNAL, e.message ?: e.javaClass.simpleName))
            }
            return
        }
        val claimed = listeners.any { runCatching { it.onRpcRequest(id, method, params, env.from ?: "") }.getOrDefault(false) }
        if (!claimed) respond(id, null, errorJson(RpcCodes.METHOD_NOT_FOUND, "no handler: $method"))
    }

    private inner class Listener(val gen: Int) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            post {
                if (gen != generation) return@post
                val hello = helloProvider()
                webSocket.send(Envelope("hello", data = hello).toJson())
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) = handleFrame(gen, text)

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(code, reason)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "ws failure: ${t.message}")
            lost(-1, t.message ?: "failure")
        }

        private fun lost(code: Int, reason: String) = post {
            if (gen != generation) return@post
            heartbeatTask?.cancel(false)
            socket = null
            failAllPending("connection lost")
            if (code == 1008) {
                wantConnected = false
                setState(HubState.UNAUTHORIZED)
            } else {
                setState(HubState.DISCONNECTED)
                scheduleReconnect()
            }
        }
    }

    companion object {
        private const val TAG = "HubClient"
        fun errorJson(code: Int, message: String): JSONObject = JSONObject().put("code", code).put("message", message)
    }
}
