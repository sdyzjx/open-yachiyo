package com.yachiyo.companion

import android.Manifest
import android.os.Build
import android.os.Bundle

class MainActivity : WebHostActivity() {
    override val mode: String = "normal"

    /** When Yachiyo is the system home app the back key must never leave it. */
    override val swallowBack: Boolean get() = isDefaultLauncher()

    override fun extraPathHandler() = CompanionApp.instance.apps.pathHandler

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        // Home pressed while we are the launcher: let the Web layer reset (close drawers etc.)
        if (intent.hasCategory(android.content.Intent.CATEGORY_HOME)) bridge.emitLifecycle("resume")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        HubService.start(this)
    }
}
