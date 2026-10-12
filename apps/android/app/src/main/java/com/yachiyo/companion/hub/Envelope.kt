package com.yachiyo.companion.hub

import org.json.JSONObject

/** Device Hub envelope (contract C1.2). */
data class Envelope(
    val type: String,
    val id: String? = null,
    val topic: String? = null,
    val data: JSONObject? = null,
    val from: String? = null,
    val ts: Long = System.currentTimeMillis(),
    val v: Int = 1
) {
    fun toJson(): String {
        val o = JSONObject()
        o.put("v", v)
        o.put("type", type)
        if (id != null) o.put("id", id)
        if (topic != null) o.put("topic", topic)
        // C1 envelopes always carry an object payload, including heartbeat frames.  The gateway
        // deliberately rejects missing data so malformed clients cannot bypass per-type checks.
        o.put("data", data ?: JSONObject())
        if (from != null) o.put("from", from)
        o.put("ts", ts)
        return o.toString()
    }

    companion object {
        /** Returns null for frames that are not valid envelopes. */
        fun parse(text: String): Envelope? = try {
            val o = JSONObject(text)
            val type = o.optString("type", "")
            if (type.isEmpty()) null
            else Envelope(
                type = type,
                id = if (o.has("id") && !o.isNull("id")) o.optString("id") else null,
                topic = if (o.has("topic") && !o.isNull("topic")) o.optString("topic") else null,
                data = o.optJSONObject("data"),
                from = if (o.has("from") && !o.isNull("from")) o.optString("from") else null,
                ts = o.optLong("ts", 0L),
                v = o.optInt("v", 1)
            )
        } catch (_: Exception) {
            null
        }
    }
}

object RpcCodes {
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602
    const val TIMEOUT = -32003
    const val PERMISSION_DENIED = -32006
    const val TARGET_OFFLINE = -32010
    const val INTERNAL = -32603
}

/** Thrown by local RPC handlers to produce a JSON-RPC style error. */
class RpcException(val code: Int, message: String) : Exception(message)

object Backoff {
    const val MIN_MS = 1000L
    const val MAX_MS = 30000L

    /** attempt 0 -> 1 s, 1 -> 2 s, ... capped at 30 s (contract C1.1). */
    fun delayMs(attempt: Int): Long {
        if (attempt < 0) return MIN_MS
        val shift = minOf(attempt, 20)
        return minOf(MIN_MS shl shift, MAX_MS)
    }
}
