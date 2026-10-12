package com.yachiyo.companion.launcher

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.LruCache
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import com.yachiyo.companion.web.WebAssets
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

object PackageNames {
    private val RE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
    fun isValid(p: String) = p.length <= 255 && RE.matches(p)

    /** `/appicon/<package>.png` path remainder -> package name, or null. */
    fun fromIconPath(path: String): String? {
        val n = path.trimStart('/')
        if (!n.endsWith(".png")) return null
        return n.removeSuffix(".png").takeIf(::isValid)
    }
}

/** Launchable-app list and rendered icons for the launcher UI (contract C2.1 / C6 `/appicon/`). */
class AppCatalog(private val ctx: Context) {
    private val cache = object : LruCache<String, ByteArray>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }

    fun list(): JSONArray {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val items = pm.queryIntentActivities(intent, 0)
            .filter { it.activityInfo.packageName != ctx.packageName }
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
        val out = JSONArray()
        for ((pkg, label) in items) out.put(JSONObject().put("package", pkg).put("label", label)
            .put("icon_url", "${WebAssets.BASE}/appicon/$pkg.png"))
        return out
    }

    fun iconPng(pkg: String): ByteArray? {
        if (!PackageNames.isValid(pkg)) return null
        cache.get(pkg)?.let { return it }
        return try {
            val d = ctx.packageManager.getApplicationIcon(pkg)
            val bytes = render(d, 144)
            cache.put(pkg, bytes); bytes
        } catch (_: Exception) { null }
    }

    private fun render(d: Drawable, size: Int): ByteArray {
        val bmp = if (d is BitmapDrawable && d.bitmap.width >= size) Bitmap.createScaledBitmap(d.bitmap, size, size, true)
        else Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { b ->
            val c = Canvas(b); d.setBounds(0, 0, size, size); d.draw(c)
        }
        return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    val pathHandler = WebViewAssetLoader.PathHandler { path ->
        val pkg = PackageNames.fromIconPath(path) ?: return@PathHandler null
        val bytes = iconPng(pkg) ?: return@PathHandler null
        WebResourceResponse("image/png", null, 200, "OK", mapOf("Cache-Control" to "max-age=3600"), ByteArrayInputStream(bytes))
    }
}
