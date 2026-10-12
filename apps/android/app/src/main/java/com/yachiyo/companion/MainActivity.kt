package com.yachiyo.companion

import android.Manifest
import android.os.Build
import android.os.Bundle

class MainActivity : WebHostActivity() {
    override val mode: String = "normal"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        HubService.start(this)
    }
}
