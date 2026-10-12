package com.yachiyo.companion.web

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileInputStream

/** Serves `assets/<prefix><path>` (e.g. /web/x -> assets/web/x). */
class AssetsDirHandler(
    private val context: Context,
    private val assetPrefix: String
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val rel = path.trimStart('/')
        if (rel.contains("..")) return null
        return try {
            val stream = context.assets.open(assetPrefix + rel)
            WebResourceResponse(MimeTypes.guess(rel), null, stream)
        } catch (_: Exception) {
            null
        }
    }
}

/** Serves files from a directory in app storage; [enabled] lets callers block it (lockscreen/plugins). */
class FilesDirHandler(
    private val root: File,
    private val enabled: () -> Boolean = { true }
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        if (!enabled()) return forbidden()
        val file = PathSafety.resolveInside(root, path) ?: return null
        if (!file.isFile) return null
        return try {
            WebResourceResponse(MimeTypes.guess(file.name), null, FileInputStream(file))
        } catch (_: Exception) {
            null
        }
    }

    private fun forbidden() = WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), "".byteInputStream())
}
