package com.yachiyo.companion.features

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.yachiyo.companion.plugins.PluginException
import com.yachiyo.companion.web.WebAssets
import java.io.File
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
    // ---- pickers (SAF) -------------------------------------------------------------------------

    private var pickerBridge: YachiyoNativeBridge? = null
    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "native-features").apply { isDaemon = true } }

    fun pickBackground(b: YachiyoNativeBridge) {
        pickerBridge = b
        launchPicker(REQ_BG, arrayOf("image/*"))
    }

    fun pickPluginPackage(b: YachiyoNativeBridge) {
        if (b.mode == "lockscreen") {
            b.dispatcher.post("picker.result", JSONObject().put("kind", "plugin").put("error", "plugins are disabled in lockscreen mode"))
            return
        }
        pickerBridge = b
        launchPicker(REQ_PLUGIN, arrayOf("application/zip", "application/octet-stream", "application/x-zip-compressed", "*/*"))
    }

    private fun launchPicker(code: Int, mimes: Array<String>) {
        host.runOnUiThread {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(if (mimes.size == 1) mimes[0] else "*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, mimes)
            try { host.startActivityForResult(i, code) } catch (e: Exception) {
                pickerBridge?.dispatcher?.post("picker.result", JSONObject()
                    .put("kind", if (code == REQ_BG) "background" else "plugin").put("error", e.message ?: "no picker"))
            }
        }
    }

    fun onActivityResult(code: Int, result: Int, data: Intent?) {
        if (code != REQ_BG && code != REQ_PLUGIN) return
        val b = pickerBridge ?: return
        val kind = if (code == REQ_BG) "background" else "plugin"
        val uri = data?.data
        if (result != Activity.RESULT_OK || uri == null) {
            b.dispatcher.post("picker.result", JSONObject().put("kind", kind).put("error", "cancelled"))
            return
        }
        worker.execute {
            try {
                if (code == REQ_BG) {
                    val url = copyBackground(uri)
                    b.dispatcher.post("picker.result", JSONObject().put("kind", kind).put("uri", uri.toString()).put("url", url))
                } else {
                    val m = host.contentResolver.openInputStream(uri)?.use { app.plugins.install(it) }
                        ?: throw PluginException("cannot open file")
                    b.dispatcher.post("picker.result", JSONObject().put("kind", kind).put("uri", uri.toString())
                        .put("url", "${WebAssets.BASE}/plugins/${m.getString("id")}/"))
                }
            } catch (e: Exception) {
                Log.w("NativeFeatures", "picker $kind failed: ${e.message}")
                b.dispatcher.post("picker.result", JSONObject().put("kind", kind).put("uri", uri.toString()).put("error", e.message ?: "error"))
            }
        }
    }

    /** Copies the picked image to files/user/backgrounds and returns its asset-loader URL (contract C6). */
    private fun copyBackground(uri: Uri): String {
        val dir = File(WebAssets.userDir(host), "backgrounds").also { it.mkdirs() }
        val mime = host.contentResolver.getType(uri).orEmpty()
        val ext = when {
            mime.contains("png") -> "png"; mime.contains("webp") -> "webp"; mime.contains("gif") -> "gif"; else -> "jpg"
        }
        val f = File(dir, "bg-${System.currentTimeMillis()}.$ext")
        host.contentResolver.openInputStream(uri)?.use { ins ->
            f.outputStream().use { os ->
                val buf = ByteArray(64 * 1024); var total = 0L
                while (true) {
                    val n = ins.read(buf); if (n < 0) break
                    total += n
                    if (total > 40L * 1024 * 1024) { f.delete(); throw PluginException("image larger than 40 MB") }
                    os.write(buf, 0, n)
                }
            }
        } ?: throw PluginException("cannot open image")
        dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(5)?.forEach { it.delete() }
        return "${WebAssets.BASE}/user/backgrounds/${f.name}"
    }

    // ---- plugins ---------------------------------------------------------------------------------

    fun listPlugins(lockscreen: Boolean): String = if (lockscreen) "[]" else app.plugins.list().toString()

    fun uninstallPlugin(b: YachiyoNativeBridge, id: String) { if (b.mode != "lockscreen") app.plugins.uninstall(id) }

    fun setPluginEnabled(b: YachiyoNativeBridge, id: String, enabled: Boolean) {
        if (b.mode != "lockscreen") app.plugins.setEnabled(id, enabled)
    }

    fun pluginStorageGet(lockscreen: Boolean, pluginId: String, key: String): String =
        if (lockscreen) "null" else app.plugins.storageGet(pluginId, key)

    fun pluginStorageSet(lockscreen: Boolean, pluginId: String, key: String, valueJson: String) {
        if (!lockscreen) try { app.plugins.storageSet(pluginId, key, valueJson) } catch (e: Exception) { Log.w("NativeFeatures", e.message ?: "") }
    }

    fun listLaunchableApps(): String = JSONArray().toString()
    fun setLockscreenEnabled(enabled: Boolean) {}

    companion object { const val REQ_MIC = 100; const val REQ_BG = 201; const val REQ_PLUGIN = 202 }
}
