package com.yachiyo.companion.bridge

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Contract C2.0: the only object injected into the page (`window.__YachiyoBridge`). Android injects
 * it into every frame, so access is gated by a one-time handshake token that only the host page's
 * first script can obtain; sandboxed plugin iframes cannot call anything useful.
 *
 * [handler] maps (method, args) to a result string, or null for an unknown method.
 */
class BridgeGate(
    private val handler: (method: String, args: JSONArray) -> String?,
    private val random: SecureRandom = SecureRandom(),
    private val warn: (String) -> Unit = { Log.w("BridgeGate", it) }
) {
    @Volatile private var token: String? = null
    @Volatile private var issued = false

    /** Called from onPageStarted: the next handshake() hands out a fresh token. */
    @Synchronized fun reset() { token = null; issued = false }

    @android.webkit.JavascriptInterface
    @Synchronized fun handshake(): String {
        if (issued) { warn("handshake called again; refused"); return "" }
        issued = true
        val b = ByteArray(32).also(random::nextBytes)
        val t = b.joinToString("") { "%02x".format(it) }
        token = t
        return t
    }

    @android.webkit.JavascriptInterface
    fun invoke(token: String, method: String, argsJson: String): String {
        val expected = this.token
        if (expected == null || !MessageDigest.isEqual(expected.toByteArray(), token.toByteArray()))
            return error(-32006, "bridge token invalid")
        val args = try { JSONArray(argsJson) } catch (_: Exception) { return error(-32602, "args must be a JSON array") }
        return try {
            handler(method, args) ?: error(-32601, "unknown method: $method")
        } catch (e: Exception) {
            error(-32603, e.message ?: e.javaClass.simpleName)
        }
    }

    companion object {
        fun error(code: Int, message: String): String =
            JSONObject().put("error", JSONObject().put("code", code).put("message", message)).toString()
    }
}
