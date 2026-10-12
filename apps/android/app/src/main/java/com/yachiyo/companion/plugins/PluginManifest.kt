package com.yachiyo.companion.plugins

import org.json.JSONArray
import org.json.JSONObject

class PluginException(message: String) : Exception(message)

/** Contract C3.1 manifest validation. */
object ManifestValidator {
    private val ID_RE = Regex("^[a-z0-9._-]{3,64}$")
    private val PERM_RE = Regex("^(bus\\.publish|bus\\.subscribe|rpc\\.call):[A-Za-z0-9_.*-]{1,200}$")
    private val PERM_SIMPLE = setOf("rpc.register", "agent.tool")
    const val SUPPORTED_SDK = 1

    fun isValidId(id: String) = ID_RE.matches(id) && !id.startsWith(".") && !id.contains("..")

    /** A relative path inside the package: no absolute path, no `..`, no backslash/NUL. */
    fun isSafeRelPath(p: String): Boolean =
        p.isNotEmpty() && !p.startsWith("/") && !p.contains('\\') && !p.contains('\u0000') &&
            p.split('/').none { it == ".." }

    /** Returns a normalized manifest (defaults filled in) or throws [PluginException]. */
    fun validate(raw: JSONObject): JSONObject {
        val id = raw.optString("id", "")
        if (!isValidId(id)) throw PluginException("invalid id '$id' (expect [a-z0-9._-]{3,64})")
        val name = raw.optString("name", "").trim()
        if (name.isEmpty()) throw PluginException("name is required")
        val version = raw.optString("version", "").trim()
        if (version.isEmpty() || version.length > 64) throw PluginException("version is required")
        val type = raw.optString("type", "")
        if (type != "app" && type != "widget") throw PluginException("type must be app or widget")
        val entry = raw.optString("entry", "index.html").ifEmpty { "index.html" }
        if (!isSafeRelPath(entry)) throw PluginException("unsafe entry path")
        val icon = raw.optString("icon", "")
        if (icon.isNotEmpty() && !isSafeRelPath(icon)) throw PluginException("unsafe icon path")
        val sdk = raw.optInt("sdk", 1)
        if (sdk < 1 || sdk > SUPPORTED_SDK) throw PluginException("unsupported sdk $sdk")

        val perms = JSONArray()
        val pa = raw.optJSONArray("permissions")
        if (pa != null) for (i in 0 until pa.length()) {
            val p = pa.optString(i, "")
            if (p !in PERM_SIMPLE && !PERM_RE.matches(p)) throw PluginException("invalid permission '$p'")
            perms.put(p)
        }

        val out = JSONObject()
            .put("id", id).put("name", name).put("version", version).put("type", type)
            .put("entry", entry).put("icon", icon).put("description", raw.optString("description", ""))
            .put("sdk", sdk).put("permissions", perms)
        if (type == "widget") {
            val w = raw.optJSONObject("widget") ?: JSONObject()
            out.put("widget", JSONObject()
                .put("w", w.optInt("w", 2).coerceIn(1, 12)).put("h", w.optInt("h", 1).coerceIn(1, 12))
                .put("min_w", w.optInt("min_w", 1).coerceIn(1, 12)).put("min_h", w.optInt("min_h", 1).coerceIn(1, 12))
                .put("max_w", w.optInt("max_w", 4).coerceIn(1, 12)).put("max_h", w.optInt("max_h", 4).coerceIn(1, 12)))
        }
        return out
    }
}
