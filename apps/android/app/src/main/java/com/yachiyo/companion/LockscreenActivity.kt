package com.yachiyo.companion

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.view.WindowManager
import com.yachiyo.companion.web.WebAssets

/**
 * Shows the Web front-end (mode=lockscreen) above the keyguard. Plugins are disabled in this mode:
 * the asset loader refuses `/plugins/` and the bridge rejects plugin-related calls and topics.
 */
class LockscreenActivity : WebHostActivity() {
    override val mode: String = "lockscreen"

    private val userPresent = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { finish() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        CompanionApp.instance.hub.setMode("lockscreen")
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        registerReceiver(userPresent, IntentFilter(Intent.ACTION_USER_PRESENT), Context.RECEIVER_NOT_EXPORTED)
        getSystemService(android.app.NotificationManager::class.java).cancel(2)  // full-screen-intent helper
        active = true
        HubService.start(this)
    }

    /** Back key / gesture: ask the system to dismiss the keyguard (PIN prompt if secure), then leave. */
    override fun defaultBack() = dismissKeyguardAndFinish()

    fun dismissKeyguardAndFinish() {
        val km = getSystemService(KeyguardManager::class.java)
        if (!km.isKeyguardLocked) {
            finish()
            return
        }
        km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() { finish() }
            override fun onDismissCancelled() { finish() }
            override fun onDismissError() { finish() }
        })
        // Some ROMs omit the callback when a showWhenLocked activity requests dismissal. Leaving
        // this overlay does not bypass authentication; the system keyguard remains underneath.
        window.decorView.postDelayed({ if (!isFinishing) finish() }, 750L)
    }

    override fun onDestroy() {
        active = false
        try { unregisterReceiver(userPresent) } catch (_: Exception) {}
        super.onDestroy()
        CompanionApp.instance.hub.setMode("normal")
    }

    companion object {
        @Volatile var active = false

        fun launchIntent(ctx: Context) = Intent(ctx, LockscreenActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
}
