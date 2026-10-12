package com.yachiyo.companion.web

import java.io.File

/** Small, deterministic extension -> MIME table (the platform table lacks mjs/wasm/moc3 etc.). */
object MimeTypes {
    private val table = mapOf(
        "html" to "text/html", "htm" to "text/html",
        "js" to "application/javascript", "mjs" to "application/javascript",
        "css" to "text/css", "json" to "application/json", "map" to "application/json",
        "wasm" to "application/wasm", "txt" to "text/plain", "md" to "text/plain",
        "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg",
        "gif" to "image/gif", "webp" to "image/webp", "svg" to "image/svg+xml", "ico" to "image/x-icon",
        "mp3" to "audio/mpeg", "wav" to "audio/wav", "ogg" to "audio/ogg", "m4a" to "audio/mp4",
        "mp4" to "video/mp4", "webm" to "video/webm",
        "woff" to "font/woff", "woff2" to "font/woff2", "ttf" to "font/ttf",
        "moc3" to "application/octet-stream", "motion3" to "application/json",
        "model3" to "application/json", "physics3" to "application/json", "cdi3" to "application/json"
    )

    fun guess(name: String): String {
        var lower = name.lowercase()
        // "foo.model3.json" etc. resolve through the last extension
        val ext = lower.substringAfterLast('.', "")
        return table[ext] ?: "application/octet-stream"
    }
}

/** Path-traversal-safe resolution of a relative URL path under a root directory. */
object PathSafety {
    /** Returns the file under [root] for [rel], or null if it escapes the root. */
    fun resolveInside(root: File, rel: String): File? {
        if (rel.contains('\u0000')) return null
        val cleaned = rel.trimStart('/')
        val canonicalRoot = root.canonicalFile
        val candidate = File(canonicalRoot, cleaned).canonicalFile
        return if (candidate.path == canonicalRoot.path ||
            candidate.path.startsWith(canonicalRoot.path + File.separator)
        ) candidate else null
    }
}
