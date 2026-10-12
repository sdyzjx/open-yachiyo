package com.yachiyo.companion.bridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HubSurfacePolicyTest {
    @Test fun onlyTheCurrentRenderSurfaceAcceptsPayloads() {
        assertTrue(HubSurfacePolicy.acceptsPayload(isSettings = false, surfaceMode = "normal", currentMode = "normal"))
        assertTrue(HubSurfacePolicy.acceptsPayload(isSettings = false, surfaceMode = "lockscreen", currentMode = "lockscreen"))
        assertFalse(HubSurfacePolicy.acceptsPayload(isSettings = true, surfaceMode = "normal", currentMode = "normal"))
        assertFalse(HubSurfacePolicy.acceptsPayload(isSettings = false, surfaceMode = "normal", currentMode = "lockscreen"))
        assertFalse(HubSurfacePolicy.acceptsPayload(isSettings = false, surfaceMode = "lockscreen", currentMode = "normal"))
    }
}
