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
import android.webkit.WebView
import com.yachiyo.companion.BuildConfig
import com.yachiyo.companion.CompanionApp
import com.yachiyo.companion.SettingsActivity
import com.yachiyo.companion.WebHostActivity
import com.yachiyo.companion.discovery.ServerDiscovery
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
    private val isSettings get() = host is SettingsActivity
    private val activeHubSurface get() = HubSurfacePolicy.acceptsPayload(isSettings, mode, hub.currentMode)
    private val pluginsBlocked get() = hub.currentMode == "lockscreen"
    private val ownedRegistrations = linkedSetOf<String>()

    val dispatcher = WebDispatcher({ script -> main.post { webView.evaluateJavascript(script, null) } })
    private val serverDiscovery = ServerDiscovery(host.applicationContext, emit = { type, data ->
        dispatcher.post(type, data)
    })

    @Volatile private var backPending = false
    private val backTimeout = Runnable {
        if (backPending) { backPending = false; host.defaultBack() }
    }

    private val hubListener = object : HubListener {
        override fun onState(state: HubState) = dispatcher.post("hub.state", hub.snapshotJson())

        override fun onEvent(topic: String, data: JSONObject, from: String) {
            if (!activeHubSurface || (pluginsBlocked && topic.startsWith("plugin."))) return
            dispatcher.post("hub.event", JSONObject().put("topic", topic).put("data", data).put("from", from))
        }

        override fun onRpcRequest(id: String, method: String, params: JSONObject, from: String): Boolean {
            if (!activeHubSurface) return false
            if (pluginsBlocked && method.startsWith("plugin.")) {
                hub.respond(id, null, HubClient.errorJson(RpcCodes.PERMISSION_DENIED, "plugins disabled in lockscreen mode"))
                return true
            }
            dispatcher.post("hub.rpc.request",
                JSONObject().put("id", id).put("method", method).put("params", params).put("from", from))
            return true
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
        serverDiscovery.stop(ServerDiscovery.REASON_LIFECYCLE)
        if (ownedRegistrations.isNotEmpty()) hub.unregister(ownedRegistrations.toList())
        ownedRegistrations.clear()
        hub.removeListener(hubListener)
        app.plugins.removeListener(pluginsListener)
        app.config.removeListener(configListener)
        main.removeCallbacks(backTimeout)
    }

    fun onPageFinished() = dispatcher.markReady()

    fun emitLifecycle(state: String) =
        dispatcher.post("lifecycle", JSONObject().put("state", state).put("mode", mode))

    /** Soft keyboard visibility/height (C2.2 `ime`). The WebView itself is never resized (adjustNothing). */
    fun emitIme(state: ImeState) =
        dispatcher.post("ime", JSONObject().put("visible", state.visible).put("height_px", state.heightPx).put("height_css", state.heightCss))

    /** Called by the activity on the back key; Web has 300 ms to answer with consumeBack(). */
    fun requestBack() {
        if (backPending) return
        backPending = true
        dispatcher.post("back", JSONObject())
        main.postDelayed(backTimeout, 300)
    }

    /** Name-based dispatch for BridgeGate.invoke (C2.0); returns null for unknown methods. */
    fun call(method: String, a: JSONArray): String? {
        fun s(i: Int) = a.optString(i, "")
        return when (method) {
            "getConfig" -> getConfig()
            "setConfig" -> setConfig(s(0))
            "getDeviceInfo" -> getDeviceInfo()
            "hubState" -> hubState()
            "hubConnect" -> { hubConnect(); "" }
            "hubDisconnect" -> { hubDisconnect(); "" }
            "hubPublish" -> { hubPublish(s(0), s(1)); "" }
            "hubSubscribe" -> { hubSubscribe(s(0)); "" }
            "hubUnsubscribe" -> { hubUnsubscribe(s(0)); "" }
            "hubRpc" -> { hubRpc(s(0), s(1), s(2), s(3)); "" }
            "hubRpcRespond" -> { hubRpcRespond(s(0), s(1), s(2)); "" }
            "hubRegister" -> { hubRegister(s(0)); "" }
            "hubUnregister" -> { hubUnregister(s(0)); "" }
            "micStart" -> { micStart(s(0)); "" }
            "micStop" -> { micStop(s(0)); "" }
            "pickBackground" -> { pickBackground(); "" }
            "pickPluginPackage" -> { pickPluginPackage(); "" }
            "listPlugins" -> listPlugins()
            "uninstallPlugin" -> { uninstallPlugin(s(0)); "" }
            "setPluginEnabled" -> { setPluginEnabled(s(0), a.optBoolean(1, true)); "" }
            "pluginStorageGet" -> pluginStorageGet(s(0), s(1))
            "pluginStorageSet" -> { pluginStorageSet(s(0), s(1), s(2)); "" }
            "openHomeSettings" -> { openHomeSettings(); "" }
            "listLaunchableApps" -> listLaunchableApps()
            "launchApp" -> { launchApp(s(0)); "" }
            "setLockscreenEnabled" -> { setLockscreenEnabled(a.optBoolean(0, false)); "" }
            "setOrientation" -> { setOrientation(s(0)); "" }
            "openSettings" -> { openSettings(); "" }
            "closeSettings" -> { closeSettings(); "" }
            "vibrate" -> { vibrate(a.optLong(0, 100)); "" }
            "log" -> { log(s(0), s(1)); "" }
            "consumeBack" -> { consumeBack(); "" }
            "dismissKeyguard" -> { dismissKeyguard(); "" }
            "startServerDiscovery" -> { startServerDiscovery(); "" }
            "stopServerDiscovery" -> { stopServerDiscovery(); "" }
            else -> null
        }
    }

    val gate = BridgeGate(::call)

    // ---- config / info ---------------------------------------------------------------------

    fun getConfig(): String = app.config.get().toString()

    fun setConfig(patchJson: String): String = try {
        app.config.set(patchJson); "ok"
    } catch (e: Exception) { errorJson(e.message ?: "error") }

    fun getDeviceInfo(): String {
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

    fun hubState(): String = hub.snapshotJson().toString()
    fun hubConnect() { hub.connect() }
    fun hubDisconnect() { hub.disconnect() }

    fun hubPublish(topic: String, dataJson: String) {
        if (!activeHubSurface || (pluginsBlocked && topic.startsWith("plugin."))) return
        val data = parseObject(dataJson) ?: JSONObject()
        hub.publish(topic, data)
    }

    fun hubSubscribe(patternsJson: String) {
        if (!activeHubSurface) return
        hub.subscribe(parseStrings(patternsJson).filterNot { pluginsBlocked && it.startsWith("plugin.") })
    }

    fun hubUnsubscribe(patternsJson: String) { if (activeHubSurface) hub.unsubscribe(parseStrings(patternsJson)) }

    fun hubRpc(callId: String, method: String, paramsJson: String, target: String) {
        if (!activeHubSurface || (pluginsBlocked && method.startsWith("plugin."))) {
            dispatcher.post("hub.rpc.result", JSONObject().put("call_id", callId)
                .put("error", HubClient.errorJson(RpcCodes.PERMISSION_DENIED, "hub calls disabled for this surface")))
            return
        }
        hub.rpc(method, parseObject(paramsJson) ?: JSONObject(), target.ifEmpty { null }) { result, error ->
            val out = JSONObject().put("call_id", callId)
            if (error != null) out.put("error", error) else out.put("result", result ?: JSONObject.NULL)
            dispatcher.post("hub.rpc.result", out)
        }
    }

    fun hubRpcRespond(reqId: String, resultJson: String, errorJson: String) {
        if (!activeHubSurface) return
        val err = if (errorJson.isNotEmpty()) parseObject(errorJson) else null
        if (err != null) hub.respond(reqId, null, err)
        else hub.respond(reqId, if (resultJson.isEmpty()) JSONObject.NULL else parseValue(resultJson), null)
    }

    fun hubRegister(methodsJson: String) {
        if (!activeHubSurface) return
        val arr = try { JSONArray(methodsJson) } catch (_: Exception) { return }
        val accepted = if (pluginsBlocked) {
            val filtered = JSONArray()
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                if (!m.optString("name").startsWith("plugin.")) filtered.put(m)
            }
            filtered
        } else arr
        for (i in 0 until accepted.length()) {
            accepted.optJSONObject(i)?.optString("name")?.takeIf { it.isNotEmpty() }?.let(ownedRegistrations::add)
        }
        hub.register(accepted)
    }

    fun hubUnregister(namesJson: String) {
        if (!activeHubSurface) return
        val names = parseStrings(namesJson)
        ownedRegistrations.removeAll(names.toSet())
        hub.unregister(names)
    }

    // ---- back / UI / misc ---------------------------------------------------------------------

    fun consumeBack() {
        backPending = false
        main.removeCallbacks(backTimeout)
    }

    fun vibrate(ms: Long) = NativeDevice.vibrate(app, ms)

    fun log(level: String, msg: String) {
        when (level.lowercase()) {
            "error" -> Log.e(TAG_WEB, msg)
            "warn" -> Log.w(TAG_WEB, msg)
            "debug" -> Log.d(TAG_WEB, msg)
            else -> Log.i(TAG_WEB, msg)
        }
    }

    /** Extra (not in C2.1): lets the lockscreen UI offer an explicit unlock gesture. */
    fun dismissKeyguard() {
        if (host is com.yachiyo.companion.LockscreenActivity) main.post { host.dismissKeyguardAndFinish() }
    }

    fun openSettings() {
        if (lockscreen) return
        main.post { host.openSettingsScreen() }
    }

    fun closeSettings() { main.post { host.closeSettingsScreen() } }

    // ---- features implemented in later tasks (stubs keep the C2.1 surface complete) -----------

    fun micStart(optionsJson: String) { host.features.micStart(this, optionsJson) }
    fun micStop(reason: String) { host.features.micStop(reason) }
    fun pickBackground() { host.features.pickBackground(this) }
    fun pickPluginPackage() { host.features.pickPluginPackage(this) }
    fun listPlugins(): String = host.features.listPlugins(pluginsBlocked)
    fun uninstallPlugin(id: String) { host.features.uninstallPlugin(this, id) }
    fun setPluginEnabled(id: String, enabled: Boolean) { host.features.setPluginEnabled(this, id, enabled) }
    fun pluginStorageGet(pluginId: String, key: String): String = host.features.pluginStorageGet(pluginsBlocked, pluginId, key)
    fun pluginStorageSet(pluginId: String, key: String, valueJson: String) { host.features.pluginStorageSet(pluginsBlocked, pluginId, key, valueJson) }
    fun openHomeSettings() { main.post { host.openHomeSettings() } }
    fun listLaunchableApps(): String = host.features.listLaunchableApps(lockscreen)
    fun launchApp(pkg: String) { if (!lockscreen) main.post { host.launchApp(pkg) } }
    fun setLockscreenEnabled(enabled: Boolean) { host.features.setLockscreenEnabled(enabled) }
    fun setOrientation(mode: String) { main.post { host.applyOrientation(mode, persist = true) } }

    fun startServerDiscovery() {
        if (lockscreen || host !is SettingsActivity) {
            dispatcher.post("server.discovery.state", JSONObject()
                .put("state", "error")
                .put("reason", ServerDiscovery.REASON_PERMISSION_DENIED)
                .put("error", "server discovery is only available from settings"))
            return
        }
        serverDiscovery.start()
    }

    fun stopServerDiscovery() = serverDiscovery.stop(ServerDiscovery.REASON_MANUAL)

    fun stopServerDiscoveryForLifecycle() = serverDiscovery.stop(ServerDiscovery.REASON_LIFECYCLE)

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
