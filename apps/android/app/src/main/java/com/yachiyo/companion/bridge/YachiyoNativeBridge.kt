package com.yachiyo.companion.bridge

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.yachiyo.companion.BuildConfig
import com.yachiyo.companion.CompanionApp
import com.yachiyo.companion.WebHostActivity
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.HubListener
import com.yachiyo.companion.hub.HubState
import com.yachiyo.companion.hub.RpcCodes
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * `window.YachiyoNative` (contract C2.1). All parameters/returns are strings. Methods run on the
 * WebView's JavaBridge thread; anything touching UI is posted to the main thread.
 */
class YachiyoNativeBridge(
    private val host: WebHostActivity,
    private val webView: WebView
) {
    private val app = CompanionApp.instance
    private val hub: HubClient get() = app.hub
    private val main = Handler(Looper.getMainLooper())
    val mode: String get() = host.mode
    private val lockscreen get() = mode == "lockscreen"

    val dispatcher = WebDispatcher({ script -> main.post { webView.evaluateJavascript(script, null) } })

    @Volatile private var backPending = false
    private val backTimeout = Runnable {
        if (backPending) { backPending = false; host.defaultBack() }
    }

    private val hubListener = object : HubListener {
        override fun onState(state: HubState) = dispatcher.post("hub.state", hub.snapshotJson())

        override fun onEvent(topic: String, data: JSONObject, from: String) {
            if (lockscreen && topic.startsWith("plugin.")) return
            dispatcher.post("hub.event", JSONObject().put("topic", topic).put("data", data).put("from", from))
        }

        override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String) {
            if (lockscreen && method.startsWith("plugin.")) {
                hub.respond(id, null, HubClient.errorJson(RpcCodes.PERMISSION_DENIED, "plugins disabled in lockscreen mode"))
                return
            }
            dispatcher.post("hub.rpc.request",
                JSONObject().put("id", id).put("method", method).put("params", params).put("from", from))
        }
    }

    private val configListener: (JSONObject) -> Unit = { cfg -> dispatcher.post("config.changed", cfg) }

    private val pluginsListener: () -> Unit = {
        dispatcher.post("plugins.changed", JSONArray(host.features.listPlugins(lockscreen)))
    }

    fun attach() {
        app.plugins.addListener(pluginsListener)
        hub.addListener(hubListener)
        app.config.addListener(configListener)
    }

    fun detach() {
        hub.removeListener(hubListener)
        app.plugins.removeListener(pluginsListener)
        app.config.removeListener(configListener)
        main.removeCallbacks(backTimeout)
    }

    fun onPageFinished() = dispatcher.markReady()

    fun emitLifecycle(state: String) =
        dispatcher.post("lifecycle", JSONObject().put("state", state).put("mode", mode))

    /** Called by the activity on the back key; Web has 300 ms to answer with consumeBack(). */
    fun requestBack() {
        if (backPending) return
        backPending = true
        dispatcher.post("back", JSONObject())
        main.postDelayed(backTimeout, 300)
    }

    // ---- config / info ---------------------------------------------------------------------

    @JavascriptInterface fun getConfig(): String = app.config.get().toString()

    @JavascriptInterface fun setConfig(patchJson: String): String = try {
        app.config.set(patchJson); "ok"
    } catch (e: Exception) { errorJson(e.message ?: "error") }

    @JavascriptInterface fun getDeviceInfo(): String {
        val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also(am::getMemoryInfo)
        return JSONObject()
            .put("device_id", app.config.deviceId())
            .put("model", Build.MODEL)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("app_version", BuildConfig.APP_VERSION)
            .put("low_ram", am.isLowRamDevice || mi.totalMem < 3L * 1024 * 1024 * 1024)
            .put("total_mem_mb", mi.totalMem / (1024 * 1024))
            .put("is_default_launcher", host.isDefaultLauncher())
            .put("mode", mode)
            .toString()
    }

    // ---- hub ---------------------------------------------------------------------------------

    @JavascriptInterface fun hubState(): String = hub.snapshotJson().toString()
    @JavascriptInterface fun hubConnect() { hub.connect() }
    @JavascriptInterface fun hubDisconnect() { hub.disconnect() }

    @JavascriptInterface fun hubPublish(topic: String, dataJson: String) {
        if (lockscreen && topic.startsWith("plugin.")) return
        val data = parseObject(dataJson) ?: JSONObject()
        hub.publish(topic, data)
    }

    @JavascriptInterface fun hubSubscribe(patternsJson: String) {
        hub.subscribe(parseStrings(patternsJson).filterNot { lockscreen && it.startsWith("plugin.") })
    }

    @JavascriptInterface fun hubUnsubscribe(patternsJson: String) { hub.unsubscribe(parseStrings(patternsJson)) }

    @JavascriptInterface fun hubRpc(callId: String, method: String, paramsJson: String, target: String) {
        if (lockscreen && method.startsWith("plugin.")) {
            dispatcher.post("hub.rpc.result", JSONObject().put("call_id", callId)
                .put("error", HubClient.errorJson(RpcCodes.PERMISSION_DENIED, "plugins disabled in lockscreen mode")))
            return
        }
        hub.rpc(method, parseObject(paramsJson) ?: JSONObject(), target.ifEmpty { null }) { result, error ->
            val out = JSONObject().put("call_id", callId)
            if (error != null) out.put("error", error) else out.put("result", result ?: JSONObject.NULL)
            dispatcher.post("hub.rpc.result", out)
        }
    }

    @JavascriptInterface fun hubRpcRespond(reqId: String, resultJson: String, errorJson: String) {
        val err = if (errorJson.isNotEmpty()) parseObject(errorJson) else null
        if (err != null) hub.respond(reqId, null, err)
        else hub.respond(reqId, if (resultJson.isEmpty()) JSONObject.NULL else parseValue(resultJson), null)
    }

    @JavascriptInterface fun hubRegister(methodsJson: String) {
        val arr = try { JSONArray(methodsJson) } catch (_: Exception) { return }
        if (lockscreen) {
            val filtered = JSONArray()
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                if (!m.optString("name").startsWith("plugin.")) filtered.put(m)
            }
            hub.register(filtered)
        } else hub.register(arr)
    }

    @JavascriptInterface fun hubUnregister(namesJson: String) { hub.unregister(parseStrings(namesJson)) }

    // ---- back / UI / misc ---------------------------------------------------------------------

    @JavascriptInterface fun consumeBack() {
        backPending = false
        main.removeCallbacks(backTimeout)
    }

    @JavascriptInterface fun vibrate(ms: Long) = NativeDevice.vibrate(app, ms)

    @JavascriptInterface fun log(level: String, msg: String) {
        when (level.lowercase()) {
            "error" -> Log.e(TAG_WEB, msg)
            "warn" -> Log.w(TAG_WEB, msg)
            "debug" -> Log.d(TAG_WEB, msg)
            else -> Log.i(TAG_WEB, msg)
        }
    }

    @JavascriptInterface fun openSettings() {
        if (lockscreen) return
        main.post { host.openSettingsScreen() }
    }

    @JavascriptInterface fun closeSettings() { main.post { host.closeSettingsScreen() } }

    // ---- features implemented in later tasks (stubs keep the C2.1 surface complete) -----------

    @JavascriptInterface fun micStart(optionsJson: String) { host.features.micStart(this, optionsJson) }
    @JavascriptInterface fun micStop(reason: String) { host.features.micStop(reason) }
    @JavascriptInterface fun pickBackground() { host.features.pickBackground(this) }
    @JavascriptInterface fun pickPluginPackage() { host.features.pickPluginPackage(this) }
    @JavascriptInterface fun listPlugins(): String = host.features.listPlugins(lockscreen)
    @JavascriptInterface fun uninstallPlugin(id: String) { host.features.uninstallPlugin(this, id) }
    @JavascriptInterface fun setPluginEnabled(id: String, enabled: Boolean) { host.features.setPluginEnabled(this, id, enabled) }
    @JavascriptInterface fun pluginStorageGet(pluginId: String, key: String): String = host.features.pluginStorageGet(lockscreen, pluginId, key)
    @JavascriptInterface fun pluginStorageSet(pluginId: String, key: String, valueJson: String) { host.features.pluginStorageSet(lockscreen, pluginId, key, valueJson) }
    @JavascriptInterface fun openHomeSettings() { main.post { host.openHomeSettings() } }
    @JavascriptInterface fun listLaunchableApps(): String = host.features.listLaunchableApps()
    @JavascriptInterface fun launchApp(pkg: String) { main.post { host.launchApp(pkg) } }
    @JavascriptInterface fun setLockscreenEnabled(enabled: Boolean) { host.features.setLockscreenEnabled(enabled) }
    @JavascriptInterface fun setOrientation(mode: String) { main.post { host.applyOrientation(mode, persist = true) } }

    companion object {
        const val TAG_WEB = "YachiyoWeb"
        fun errorJson(msg: String) = JSONObject().put("error", msg).toString()

        fun parseObject(s: String): JSONObject? = try { JSONObject(s) } catch (_: Exception) { null }
        fun parseValue(s: String): Any? = try { JSONTokener(s).nextValue() } catch (_: Exception) { s }
        fun parseStrings(s: String): List<String> = try {
            val a = JSONArray(s); (0 until a.length()).map { a.getString(it) }
        } catch (_: Exception) { emptyList() }
    }
}

object NativeDevice {
    @Suppress("DEPRECATION")
    fun vibrate(ctx: Context, ms: Long) {
        val d = ms.coerceIn(10L, 2000L)
        val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE))
        else v.vibrate(d)
    }
}
