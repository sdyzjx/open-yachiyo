package com.yachiyo.companion.config

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MemKv : KeyValueStore {
    val m = HashMap<String, String>()
    override fun getString(key: String) = m[key]
    override fun putString(key: String, value: String) { m[key] = value }
}

class ConfigStoreTest {
    @Test fun defaultsWhenEmpty() {
        val c = ConfigStore(MemKv()).get()
        assertEquals(3000, c.getJSONObject("server").getInt("port"))
        assertEquals("auto", c.getString("orientation"))
    }

    @Test fun patchMergesNestedAndKeepsSiblings() {
        val s = ConfigStore(MemKv())
        s.set("""{"server":{"host":"10.0.0.2"},"appearance":{"background":{"color":"#000000"}}}""")
        val c = s.get()
        assertEquals("10.0.0.2", c.getJSONObject("server").getString("host"))
        assertEquals(3000, c.getJSONObject("server").getInt("port"))
        val bg = c.getJSONObject("appearance").getJSONObject("background")
        assertEquals("#000000", bg.getString("color"))
        assertEquals("color", bg.getString("type"))
        assertTrue(c.getJSONObject("appearance").getBoolean("portrait_full_body"))
    }

    @Test fun arraysReplace() {
        val s = ConfigStore(MemKv())
        s.set("""{"plugins":{"app_order":["a","b"]}}""")
        s.set("""{"plugins":{"app_order":["c"]}}""")
        assertEquals(1, s.get().getJSONObject("plugins").getJSONArray("app_order").length())
    }

    @Test fun broadcastsAndPersists() {
        val kv = MemKv()
        val s = ConfigStore(kv)
        var got: JSONObject? = null
        s.addListener { got = it }
        s.set("""{"orientation":"landscape"}""")
        assertEquals("landscape", got!!.getString("orientation"))
        assertEquals("landscape", ConfigStore(kv).get().getString("orientation"))
    }

    @Test fun invalidPatchThrows() {
        try { ConfigStore(MemKv()).set("{nope"); throw AssertionError("expected") } catch (_: IllegalArgumentException) {}
    }

    @Test fun deviceIdStable() {
        val kv = MemKv()
        val a = ConfigStore(kv).deviceId()
        assertTrue(a.startsWith("android-"))
        assertEquals(a, ConfigStore(kv).deviceId())
    }
}
