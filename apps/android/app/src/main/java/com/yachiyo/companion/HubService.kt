package com.yachiyo.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
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

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Yachiyo connection", NotificationManager.IMPORTANCE_LOW))
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
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "hub"
        private const val NOTIF_ID = 1
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
