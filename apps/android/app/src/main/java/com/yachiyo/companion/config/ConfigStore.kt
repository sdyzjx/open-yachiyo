package com.yachiyo.companion.config

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/** Minimal string KV abstraction so ConfigStore is unit-testable on the JVM. */
interface KeyValueStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
}

class PrefsKeyValueStore(context: Context, name: String = "yachiyo") : KeyValueStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) { prefs.edit().putString(key, value).apply() }
}

object ConfigDefaults {
    /** Contract C2.3 defaults. */
    const val JSON = """{
      "server": {"host": "192.168.20.212", "port": 3000, "token": "", "auto_connect": true},
      "appearance": {
        "background": {"type": "color", "color": "#1d2233", "image_url": ""},
        "portrait_full_body": true,
        "landscape_focus": "upper_body",
        "model_quality": "auto"
      },
      "task_canvas": {"position": "top", "opacity": 0.85},
      "audio": {"mic_mode": "push_to_talk", "volume": 1.0},
      "launcher": {"enabled": false},
      "lockscreen": {"enabled": false},
      "orientation": "auto",
      "plugins": {"app_order": [], "widget_layout": []},
      "device": {"alias": "mi6"}
    }"""
}

object ConfigMerge {
    /**
     * Merges [patch] into [base]: JSON objects merge recursively key by key; any other value
     * (including arrays) replaces. Returns a new object; inputs are not modified.
     */
    fun merge(base: JSONObject, patch: JSONObject): JSONObject {
        val out = JSONObject(base.toString())
        val keys = patch.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val pv = patch.get(k)
            val bv = if (out.has(k)) out.get(k) else null
            if (pv is JSONObject && bv is JSONObject) out.put(k, merge(bv, pv))
            else out.put(k, if (pv is JSONObject) JSONObject(pv.toString()) else if (pv is JSONArray) JSONArray(pv.toString()) else pv)
        }
        return out
    }
}

class ConfigStore(private val kv: KeyValueStore) {
    private val listeners = CopyOnWriteArrayList<(JSONObject) -> Unit>()

    @Synchronized
    fun get(): JSONObject {
        val defaults = JSONObject(ConfigDefaults.JSON)
        val saved = kv.getString(KEY_CONFIG) ?: return defaults
        return try {
            ConfigMerge.merge(defaults, JSONObject(saved))
        } catch (_: Exception) {
            defaults
        }
    }

    /** Applies a shallow/recursive patch, persists, broadcasts. Throws IllegalArgumentException on bad JSON. */
    fun set(patchJson: String): JSONObject {
        val patch = try { JSONObject(patchJson) } catch (e: Exception) { throw IllegalArgumentException("invalid json: ${e.message}") }
        val merged: JSONObject
        synchronized(this) {
            merged = ConfigMerge.merge(get(), patch)
            kv.putString(KEY_CONFIG, merged.toString())
        }
        listeners.forEach { it(merged) }
        return merged
    }

    @Synchronized
    fun deviceId(): String {
        kv.getString(KEY_DEVICE_ID)?.let { return it }
        val id = "android-" + UUID.randomUUID().toString()
        kv.putString(KEY_DEVICE_ID, id)
        return id
    }

    fun addListener(l: (JSONObject) -> Unit) { listeners.add(l) }
    fun removeListener(l: (JSONObject) -> Unit) { listeners.remove(l) }

    companion object {
        const val KEY_CONFIG = "config"
        const val KEY_DEVICE_ID = "device_id"
    }
}
