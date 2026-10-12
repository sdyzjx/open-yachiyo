package com.yachiyo.companion.web

import android.content.Context
import androidx.webkit.WebViewAssetLoader
import java.io.File

/** Contract C6: URL-prefix -> storage mapping for WebViewAssetLoader. */
object WebAssets {
    const val HOST = "appassets.androidplatform.net"
    const val BASE = "https://$HOST"

    fun pluginsDir(ctx: Context) = File(ctx.filesDir, "plugins").also { it.mkdirs() }
    fun userDir(ctx: Context) = File(ctx.filesDir, "user").also { it.mkdirs() }

    fun hasWebFrontend(ctx: Context): Boolean = try {
        ctx.assets.open("web/index.html").close(); true
    } catch (_: Exception) {
        false
    }

    fun entryUrl(ctx: Context, mode: String): String {
        val page = if (hasWebFrontend(ctx)) "/web/index.html" else "/fallback/index.html"
        return "$BASE$page?mode=$mode"
    }

    fun buildLoader(
        ctx: Context,
        pluginsEnabled: () -> Boolean,
        appIconHandler: WebViewAssetLoader.PathHandler? = null
    ): WebViewAssetLoader {
        val b = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/web/", AssetsDirHandler(ctx, "web/"))
            .addPathHandler("/sdk/", AssetsDirHandler(ctx, "web/sdk/"))
            .addPathHandler("/generated/", AssetsDirHandler(ctx, "generated/"))
            .addPathHandler("/fallback/", AssetsDirHandler(ctx, "fallback/"))
            .addPathHandler("/plugins/", FilesDirHandler(pluginsDir(ctx), pluginsEnabled))
            .addPathHandler("/user/", FilesDirHandler(userDir(ctx)))
        if (appIconHandler != null) b.addPathHandler("/appicon/", appIconHandler)
        return b.build()
    }
}
