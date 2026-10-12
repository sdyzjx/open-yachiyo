package com.yachiyo.companion.device

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.widget.Toast
import com.yachiyo.companion.BuildConfig
import com.yachiyo.companion.bridge.NativeDevice
import com.yachiyo.companion.hub.HubClient
import com.yachiyo.companion.hub.RpcCodes
import com.yachiyo.companion.hub.RpcException
import org.json.JSONArray
import org.json.JSONObject

/** Pure descriptors + argument validation (unit-tested). */
object DeviceMethodSpecs {
    val NAMES = listOf("device.vibrate", "device.battery.get", "device.toast", "device.screen.wake", "device.info")

    private fun spec(name: String, desc: String, props: JSONObject = JSONObject(), required: List<String> = emptyList()): JSONObject {
        val schema = JSONObject().put("type", "object").put("properties", props)
        if (required.isNotEmpty()) schema.put("required", JSONArray(required))
        return JSONObject().put("name", name).put("description", desc)
            .put("params_schema", schema).put("expose_as_tool", true).put("scope", "device")
    }

    /** `rpc.register` payload per contract C1.6. */
    fun descriptors(): JSONArray = JSONArray()
        .put(spec("device.vibrate", "让手机振动",
            JSONObject().put("ms", JSONObject().put("type", "integer").put("minimum", 10).put("maximum", 2000))))
        .put(spec("device.battery.get", "读取手机电量与充电状态"))
        .put(spec("device.toast", "在手机屏幕上显示一条提示",
            JSONObject().put("text", JSONObject().put("type", "string").put("maxLength", 200)), listOf("text")))
        .put(spec("device.screen.wake", "点亮手机屏幕一段时间",
            JSONObject().put("ms", JSONObject().put("type", "integer").put("minimum", 1000).put("maximum", 60000))))
        .put(spec("device.info", "读取手机型号、系统版本、内存等信息"))

    fun vibrateMs(p: JSONObject): Long {
        val ms = p.optLong("ms", 200)
        if (ms < 10 || ms > 2000) throw RpcException(RpcCodes.INVALID_PARAMS, "ms must be 10..2000")
        return ms
    }

    fun toastText(p: JSONObject): String {
        val t = p.optString("text", "")
        if (t.isEmpty()) throw RpcException(RpcCodes.INVALID_PARAMS, "text required")
        return t.take(200)
    }

    fun wakeMs(p: JSONObject): Long {
        val ms = p.optLong("ms", 5000)
        if (ms < 1000 || ms > 60000) throw RpcException(RpcCodes.INVALID_PARAMS, "ms must be 1000..60000")
        return ms
    }
}

/** Registers `device.*` native RPC methods on the hub (contract C1.6, expose_as_tool). */
class DeviceMethods(private val ctx: Context) {
    private val main = Handler(Looper.getMainLooper())

    fun install(hub: HubClient) {
        hub.registerLocal("device.vibrate") { p -> NativeDevice.vibrate(ctx, DeviceMethodSpecs.vibrateMs(p)); JSONObject().put("ok", true) }
        hub.registerLocal("device.battery.get") { battery() }
        hub.registerLocal("device.toast") { p ->
            val t = DeviceMethodSpecs.toastText(p)
            main.post { Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show() }
            JSONObject().put("ok", true)
        }
        hub.registerLocal("device.screen.wake") { p -> wake(DeviceMethodSpecs.wakeMs(p)); JSONObject().put("ok", true) }
        hub.registerLocal("device.info") { info() }
        hub.register(DeviceMethodSpecs.descriptors())
    }

    private fun battery(): JSONObject {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return JSONObject().put("level", if (level < 0) JSONObject.NULL else level * 100 / scale).put("charging", charging)
    }

    @Suppress("DEPRECATION")
    private fun wake(ms: Long) {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "yachiyo:wake")
            .acquire(ms)
    }

    private fun info(): JSONObject {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also(am::getMemoryInfo)
        val dm = ctx.resources.displayMetrics
        return JSONObject()
            .put("model", Build.MODEL).put("manufacturer", Build.MANUFACTURER)
            .put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT)
            .put("app_version", BuildConfig.APP_VERSION)
            .put("total_mem_mb", mi.totalMem / (1024 * 1024))
            .put("screen", JSONObject().put("w", dm.widthPixels).put("h", dm.heightPixels).put("dpr", dm.density.toDouble()))
    }
}
