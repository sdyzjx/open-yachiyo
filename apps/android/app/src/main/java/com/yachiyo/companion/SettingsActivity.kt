package com.yachiyo.companion

import com.yachiyo.companion.web.WebAssets

/** Hosts the settings page (`/web/settings.html`) with its own bridge instance. */
class SettingsActivity : WebHostActivity() {
    override val mode: String = "normal"

    override fun entryUrl(): String =
        if (WebAssets.hasWebFrontend(this)) "${WebAssets.BASE}/web/settings.html?mode=$mode"
        else "${WebAssets.BASE}/fallback/index.html?mode=$mode&page=settings"
}
