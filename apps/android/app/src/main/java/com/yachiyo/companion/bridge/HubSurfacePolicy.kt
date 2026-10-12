package com.yachiyo.companion.bridge

/** Routes one process-wide Hub stream to the single WebView allowed to render device payloads. */
object HubSurfacePolicy {
    fun acceptsPayload(isSettings: Boolean, surfaceMode: String, currentMode: String): Boolean =
        !isSettings && surfaceMode == currentMode
}
