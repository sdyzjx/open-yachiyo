package com.yachiyo.companion.features

import com.yachiyo.companion.WebHostActivity
import com.yachiyo.companion.bridge.YachiyoNativeBridge
import org.json.JSONArray
import org.json.JSONObject

/** Facade for Bridge features backed by native subsystems (mic, plugins, pickers, launcher). */
class NativeFeatures(private val host: WebHostActivity) {
    private fun nyi() = YachiyoNativeBridge.errorJson("not_implemented")

    fun micStart(b: YachiyoNativeBridge, optionsJson: String) {}
    fun micStop(reason: String) {}
    fun pickBackground(b: YachiyoNativeBridge) {}
    fun pickPluginPackage(b: YachiyoNativeBridge) {}
    fun listPlugins(lockscreen: Boolean): String = JSONArray().toString()
    fun uninstallPlugin(b: YachiyoNativeBridge, id: String) {}
    fun setPluginEnabled(b: YachiyoNativeBridge, id: String, enabled: Boolean) {}
    fun pluginStorageGet(lockscreen: Boolean, pluginId: String, key: String): String = "null"
    fun pluginStorageSet(lockscreen: Boolean, pluginId: String, key: String, valueJson: String) {}
    fun listLaunchableApps(): String = JSONArray().toString()
    fun setLockscreenEnabled(enabled: Boolean) {}
}
