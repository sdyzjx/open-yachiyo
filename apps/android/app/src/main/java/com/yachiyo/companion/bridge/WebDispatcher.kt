package com.yachiyo.companion.bridge

import org.json.JSONObject

/**
 * Native -> Web event pump (contract C2.2). Messages produced before the page is ready are queued
 * and flushed in order by [markReady]. [evaluate] must run the script on the UI thread.
 */
class WebDispatcher(private val evaluate: (String) -> Unit, private val maxQueue: Int = 500) {
    private val queue = ArrayDeque<String>()
    private var ready = false

    fun post(type: String, data: JSONObject) {
        val json = JSONObject().put("type", type).put("data", data).toString()
        val script: String?
        synchronized(this) {
            if (!ready) {
                if (queue.size >= maxQueue) queue.removeFirst()
                queue.addLast(json)
                return
            }
            script = buildScript(json)
        }
        evaluate(script!!)
    }

    fun markReady() {
        val scripts: List<String>
        synchronized(this) {
            ready = true
            scripts = queue.map(::buildScript)
            queue.clear()
        }
        scripts.forEach(evaluate)
    }

    fun markNotReady() = synchronized(this) { ready = false }

    companion object {
        /**
         * The page may not have defined `__yachiyoNative` yet even after onPageFinished (async
         * module scripts), so fall back to a global queue the front-end can drain.
         */
        fun buildScript(json: String): String {
            val lit = json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
            return "(function(m){var n=window.__yachiyoNative;if(n&&typeof n.dispatch==='function'){n.dispatch(m);}" +
                "else{(window.__yachiyoQueue=window.__yachiyoQueue||[]).push(m);}})($lit);"
        }
    }
}
