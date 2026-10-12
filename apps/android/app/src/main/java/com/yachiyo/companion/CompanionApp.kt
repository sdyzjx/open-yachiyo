package com.yachiyo.companion

import android.app.Application
import android.os.Build
import com.yachiyo.companion.config.ConfigStore
import com.yachiyo.companion.config.PrefsKeyValueStore
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.HubConfig
import org.json.JSONArray
import org.json.JSONObject

/** Process-wide holder for long-lived singletons (config, hub). */
class CompanionApp : Application() {
    val config: ConfigStore by lazy { ConfigStore(PrefsKeyValueStore(this)) }

    val hub: HubClient by lazy {
        HubClient(
            configProvider = {
                val s = config.get().getJSONObject("server")
                HubConfig(s.optString("host"), s.optInt("port", 3000), s.optString("token"))
            },
            helloProvider = ::buildHello
        )
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    private fun buildHello(): JSONObject {
        val dm = resources.displayMetrics
        val c = config.get()
        val portrait = dm.heightPixels >= dm.widthPixels
        return JSONObject()
            .put("device_id", config.deviceId())
            .put("device_type", "android")
            .put("name", c.optJSONObject("device")?.optString("alias").orEmpty().ifEmpty { Build.MODEL })
            .put("app_version", BuildConfig.APP_VERSION)
            .put("mode", hub.currentMode)
            .put("capabilities", JSONArray(listOf("live2d", "audio.play", "audio.capture", "plugins")))
            .put("screen", JSONObject()
                .put("w", dm.widthPixels).put("h", dm.heightPixels)
                .put("dpr", dm.density.toDouble())
                .put("orientation", if (portrait) "portrait" else "landscape"))
    }

    companion object {
        lateinit var instance: CompanionApp
            private set
    }
}
