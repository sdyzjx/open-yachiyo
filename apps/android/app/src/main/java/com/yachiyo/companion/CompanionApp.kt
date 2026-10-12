package com.yachiyo.companion

import android.app.Application

/** Process-wide holder for long-lived singletons (config, hub, plugins). */
class CompanionApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: CompanionApp
            private set
    }
}
