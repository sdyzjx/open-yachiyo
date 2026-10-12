package com.yachiyo.companion.plugins

import android.util.Log
import com.yachiyo.companion.config.ConfigStore
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.HubListener
import com.yachiyo.companion.hub.HubConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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
        if (!PushPolicy.trustedSender(from)) {
            Log.w("PluginPush", "ignoring plugin.install relayed from '$from'")
            return
        }
        exec.execute { handle(data) }
    }

    fun resolveUrl(url: String): String {
        val s = config.get().getJSONObject("server")
        return PushPolicy.resolveUrl(url, s.optString("host"), s.optInt("port", 3000))
    }

    internal fun handle(data: JSONObject) {
        val pluginId = data.optString("plugin_id")
        if (hub.currentMode == "lockscreen") { fail(pluginId, "plugins are disabled in lockscreen mode"); return }
        try {
            val url = data.optString("url")
            if (url.isEmpty()) throw PluginException("missing url")
            if (data.optString("sha256").isEmpty()) throw PluginException("sha256 required")
            val resolved = resolveUrl(url)   // throws PluginException("foreign_url") for other hosts
            val token = config.get().getJSONObject("server").optString("token")
            val m = plugins.installFromUrl(http, resolved, token, data.optString("sha256"))
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
        val code = if (reason.startsWith("foreign_url")) "foreign_url" else reason
        hub.publish("plugin.install_failed", JSONObject().put("plugin_id", pluginId).put("error", reason).put("reason", code))
    }
}

/** Pure security policy for pushed installs (unit-tested). */
object PushPolicy {
    /** Only the gateway/runtime may trigger installs, never another device or plugin relayed via the hub. */
    fun trustedSender(from: String) = from == "gateway" || from == "runtime"

    /**
     * Relative URLs resolve against the configured server; absolute URLs must match its
     * scheme, host and port exactly, otherwise PluginException("foreign_url") so the bearer token
     * is never sent elsewhere.
     */
    fun resolveUrl(url: String, host: String, port: Int): String {
        val h = host.trim()
        val base = (if (h.startsWith("ws://") || h.startsWith("wss://")) h.replaceFirst("ws", "http") else "http://${HubConfig.hostForUrl(h)}:$port")
            .trimEnd('/').toHttpUrlOrNull() ?: throw PluginException("bad server config")
        if (!(url.startsWith("http://") || url.startsWith("https://"))) {
            if (url.startsWith("//")) throw PluginException("foreign_url")
            return base.toString().trimEnd('/') + (if (url.startsWith("/")) url else "/$url")
        }
        val u = url.toHttpUrlOrNull() ?: throw PluginException("foreign_url")
        if (u.scheme != base.scheme || !u.host.equals(base.host, true) || u.port != base.port)
            throw PluginException("foreign_url: ${u.host}:${u.port} is not the configured server")
        return u.toString()
    }
}
