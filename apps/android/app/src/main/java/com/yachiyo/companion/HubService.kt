package com.yachiyo.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.util.Log
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.yachiyo.companion.hub.HubListener
import com.yachiyo.companion.hub.HubState

/**
 * Foreground service that keeps the process (and thus the Device Hub WebSocket owned by
 * [CompanionApp.hub]) alive while the UI is in the background or the screen is off.
 */
class HubService : Service() {
    private val listener = object : HubListener {
        override fun onState(state: HubState) = refreshNotification()
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) onScreenOff()
        }
    }

    /** Pre-launches the lockscreen activity while the screen is off so it is on top when it wakes. */
    private fun onScreenOff() {
        val app = CompanionApp.instance
        if (!app.config.get().getJSONObject("lockscreen").optBoolean("enabled", false)) return
        if (LockscreenActivity.active) return
        val intent = LockscreenActivity.launchIntent(this)
        try { startActivity(intent) } catch (e: Exception) { Log.w("HubService", "direct launch blocked: ${e.message}") }
        // Full-screen-intent notification is the platform-sanctioned way to start over the keyguard.
        val nm = getSystemService(NotificationManager::class.java)
        val pi = PendingIntent.getActivity(this, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        nm.notify(NOTIF_LOCK, Notification.Builder(this, CHANNEL_LOCK)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("Yachiyo")
            .setCategory(Notification.CATEGORY_ALARM).setFullScreenIntent(pi, true).setAutoCancel(true)
            .setTimeoutAfter(10_000).build())
    }

    override fun onCreate() {
        super.onCreate()
        registerReceiver(screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Yachiyo connection", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CHANNEL_LOCK, "Lockscreen", NotificationManager.IMPORTANCE_HIGH))
        CompanionApp.instance.hub.addListener(listener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        micActive = intent?.getBooleanExtra(EXTRA_MIC, micActive) ?: micActive
        enterForeground()
        val app = CompanionApp.instance
        if (app.config.get().getJSONObject("server").optBoolean("auto_connect", true) &&
            app.hub.state == HubState.DISCONNECTED
        ) app.hub.connect()
        return START_STICKY
    }

    private fun enterForeground() {
        val n = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                if (micActive && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED)
                    type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                startForeground(NOTIF_ID, n, type)
            } else startForeground(NOTIF_ID, n)
        } catch (e: Exception) {
            android.util.Log.w("HubService", "startForeground failed: ${e.message}")
        }
    }

    private fun refreshNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val st = CompanionApp.instance.hub.state
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Yachiyo")
            .setContentText(when (st) {
                HubState.CONNECTED -> "已连接到电脑"
                HubState.CONNECTING -> "正在连接…"
                HubState.UNAUTHORIZED -> "配对令牌无效"
                HubState.DISCONNECTED -> "未连接"
            })
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    override fun onDestroy() {
        CompanionApp.instance.hub.removeListener(listener)
        try { unregisterReceiver(screenReceiver) } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "hub"
        private const val NOTIF_ID = 1
        private const val NOTIF_LOCK = 2
        private const val CHANNEL_LOCK = "lockscreen"
        const val EXTRA_MIC = "mic"
        @Volatile var micActive = false

        fun start(ctx: Context, mic: Boolean = micActive) {
            micActive = mic
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, HubService::class.java).putExtra(EXTRA_MIC, mic))
            } catch (e: Exception) {
                android.util.Log.w("HubService", "start failed: ${e.message}")
            }
        }

        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, HubService::class.java)) }
    }
}
