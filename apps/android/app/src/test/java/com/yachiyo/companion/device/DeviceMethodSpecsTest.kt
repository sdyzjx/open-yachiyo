package com.yachiyo.companion.device

import com.yachiyo.companion.hub.RpcCodes
import com.yachiyo.companion.hub.RpcException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DeviceMethodSpecsTest {
    @Test fun descriptorsCoverAllMethodsAndExposeAsTool() {
        val d = DeviceMethodSpecs.descriptors()
        val names = (0 until d.length()).map { d.getJSONObject(it).getString("name") }
        assertEquals(DeviceMethodSpecs.NAMES, names)
        for (i in 0 until d.length()) {
            val m = d.getJSONObject(i)
            assertTrue(m.getBoolean("expose_as_tool"))
            assertEquals("device", m.getString("scope"))
            assertEquals("object", m.getJSONObject("params_schema").getString("type"))
        }
    }

    @Test fun vibrateRange() {
        assertEquals(200L, DeviceMethodSpecs.vibrateMs(JSONObject()))
        assertEquals(500L, DeviceMethodSpecs.vibrateMs(JSONObject().put("ms", 500)))
        try { DeviceMethodSpecs.vibrateMs(JSONObject().put("ms", 5000)); fail() }
        catch (e: RpcException) { assertEquals(RpcCodes.INVALID_PARAMS, e.code) }
    }

    @Test fun toastRequiresText() {
        assertEquals("hi", DeviceMethodSpecs.toastText(JSONObject().put("text", "hi")))
        try { DeviceMethodSpecs.toastText(JSONObject()); fail() } catch (_: RpcException) {}
        assertEquals(200, DeviceMethodSpecs.toastText(JSONObject().put("text", "x".repeat(300))).length)
    }

    @Test fun wakeRange() {
        assertEquals(5000L, DeviceMethodSpecs.wakeMs(JSONObject()))
        try { DeviceMethodSpecs.wakeMs(JSONObject().put("ms", 10)); fail() } catch (_: RpcException) {}
    }
}
