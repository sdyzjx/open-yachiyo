package com.yachiyo.companion.features

import android.Manifest
import android.content.pm.PackageManager
import com.yachiyo.companion.CompanionApp
import com.yachiyo.companion.HubService
import com.yachiyo.companion.audio.MicSink
import com.yachiyo.companion.WebHostActivity
import com.yachiyo.companion.bridge.YachiyoNativeBridge
import org.json.JSONArray
import org.json.JSONObject

/** Facade for Bridge features backed by native subsystems (mic, plugins, pickers, launcher). */
class NativeFeatures(private val host: WebHostActivity) {
    private fun nyi() = YachiyoNativeBridge.errorJson("not_implemented")

    private val app = CompanionApp.instance
    private var micSink: MicSink? = null
    private var pendingMic: Pair<YachiyoNativeBridge, String>? = null

    private fun sinkFor(b: YachiyoNativeBridge) = object : MicSink {
        override fun micState(state: String, streamId: String?, error: String?) {
            val d = JSONObject().put("state", state)
            if (streamId != null) d.put("stream_id", streamId)
            if (error != null) d.put("error", error)
            b.dispatcher.post("mic.state", d)
        }
        override fun micLevel(rms: Double) = b.dispatcher.post("mic.level", JSONObject().put("rms", rms))
    }

    fun micStart(b: YachiyoNativeBridge, optionsJson: String) {
        val sink = sinkFor(b)
        if (host.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingMic = b to optionsJson
            host.runOnUiThread { host.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC) }
            return
        }
        val mode = YachiyoNativeBridge.parseObject(optionsJson)?.optString("mode").orEmpty()
            .ifEmpty { app.config.get().getJSONObject("audio").optString("mic_mode", "push_to_talk") }
        HubService.start(host, mic = true)
        val err = app.mic.start(mode, sink, app.config.deviceId())
        if (err != null) sink.micState("error", error = err)
        else micSink = sink
    }

    fun micStop(reason: String) {
        app.mic.stop(reason, micSink)
        micSink = null
        HubService.start(host, mic = false)
    }

    fun onPermissionResult(code: Int, granted: Boolean) {
        if (code != REQ_MIC) return
        val p = pendingMic ?: return
        pendingMic = null
        if (granted) micStart(p.first, p.second)
        else sinkFor(p.first).micState("error", error = "RECORD_AUDIO permission denied")
    }
    fun pickBackground(b: YachiyoNativeBridge) {}
    fun pickPluginPackage(b: YachiyoNativeBridge) {}
    fun listPlugins(lockscreen: Boolean): String = JSONArray().toString()
    fun uninstallPlugin(b: YachiyoNativeBridge, id: String) {}
    fun setPluginEnabled(b: YachiyoNativeBridge, id: String, enabled: Boolean) {}
    fun pluginStorageGet(lockscreen: Boolean, pluginId: String, key: String): String = "null"
    fun pluginStorageSet(lockscreen: Boolean, pluginId: String, key: String, valueJson: String) {}
    fun listLaunchableApps(): String = JSONArray().toString()
    fun setLockscreenEnabled(enabled: Boolean) {}

    companion object { const val REQ_MIC = 100 }
}
