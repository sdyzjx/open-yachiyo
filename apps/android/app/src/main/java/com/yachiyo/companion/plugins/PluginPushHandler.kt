package com.yachiyo.companion.plugins

import android.util.Log
import com.yachiyo.companion.config.ConfigStore
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.HubListener
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Handles gateway `plugin.install` pushes (contract C1.4): download, verify, install, acknowledge. */
class PluginPushHandler(
    private val hub: HubClient,
    private val plugins: PluginManager,
    private val config: ConfigStore,
    private val http: OkHttpClient = OkHttpClient.Builder().callTimeout(120, TimeUnit.SECONDS).build()
) : HubListener {
    private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "plugin-push").apply { isDaemon = true } }

    fun start() {
        hub.addListener(this)
        hub.subscribe(listOf("plugin.install"))
    }

    override fun onEvent(topic: String, data: JSONObject, from: String) {
        if (topic != "plugin.install") return
        exec.execute { handle(data) }
    }

    fun resolveUrl(url: String): String {
        if (url.startsWith("http://") || url.startsWith("https://")) return url
        val s = config.get().getJSONObject("server")
        return "http://${s.optString("host")}:${s.optInt("port", 3000)}" + (if (url.startsWith("/")) url else "/$url")
    }

    internal fun handle(data: JSONObject) {
        val pluginId = data.optString("plugin_id")
        if (hub.currentMode == "lockscreen") { fail(pluginId, "plugins are disabled in lockscreen mode"); return }
        try {
            val url = data.optString("url")
            if (url.isEmpty()) throw PluginException("missing url")
            val token = config.get().getJSONObject("server").optString("token")
            val m = plugins.installFromUrl(http, resolveUrl(url), token, data.optString("sha256"))
            if (pluginId.isNotEmpty() && pluginId != m.getString("id")) {
                plugins.uninstall(m.getString("id"))
                throw PluginException("plugin_id mismatch: manifest has ${m.getString("id")}")
            }
            hub.publish("plugin.installed", JSONObject().put("plugin_id", m.getString("id")).put("version", m.getString("version")))
        } catch (e: PluginException) {
            fail(pluginId, e.message ?: "error")
        } catch (e: Exception) {
            fail(pluginId, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun fail(pluginId: String, reason: String) {
        Log.w("PluginPush", "install failed ($pluginId): $reason")
        hub.publish("plugin.install_failed", JSONObject().put("plugin_id", pluginId).put("error", reason))
    }
}
