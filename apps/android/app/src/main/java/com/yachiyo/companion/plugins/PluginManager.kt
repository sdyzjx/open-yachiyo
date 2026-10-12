package com.yachiyo.companion.plugins

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Installed-plugin registry under `<filesDir>/plugins` (code), `plugin-meta` (enabled/installed_at)
 * and `plugin-kv` (per-plugin storage; survives reinstall, removed on uninstall).
 */
class PluginManager(
    private val filesDir: File,
    private val baseUrl: String = "https://appassets.androidplatform.net",
    private val clock: () -> Long = System::currentTimeMillis
) {
    val pluginsDir = File(filesDir, "plugins")
    private val metaDir = File(filesDir, "plugin-meta")
    private val kvDir = File(filesDir, "plugin-kv")
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val installer = PluginInstaller(pluginsDir)

    init { pluginsDir.mkdirs(); metaDir.mkdirs(); kvDir.mkdirs() }

    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    private fun changed() = listeners.forEach { runCatching { it() } }

    @Synchronized
    fun install(zip: InputStream): JSONObject {
        val m = installer.install(zip)
        val id = m.getString("id")
        val meta = readJson(File(metaDir, "$id.json"))
        meta.put("installed_at", clock())
        if (!meta.has("enabled")) meta.put("enabled", true)
        File(metaDir, "$id.json").writeText(meta.toString())
        changed()
        return m
    }

    @Synchronized
    fun list(): JSONArray {
        val out = JSONArray()
        val dirs = pluginsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }?.sortedBy { it.name } ?: emptyList()
        for (d in dirs) {
            val mf = File(d, "manifest.json")
            if (!mf.isFile) continue
            val m = try { JSONObject(mf.readText()) } catch (_: Exception) { continue }
            val meta = readJson(File(metaDir, "${d.name}.json"))
            m.put("base_url", "$baseUrl/plugins/${d.name}/")
            m.put("installed_at", meta.optLong("installed_at", 0))
            m.put("enabled", meta.optBoolean("enabled", true))
            out.put(m)
        }
        return out
    }

    @Synchronized
    fun uninstall(id: String): Boolean {
        if (!ManifestValidator.isValidId(id)) return false
        val existed = File(pluginsDir, id).deleteRecursively()
        File(metaDir, "$id.json").delete()
        File(kvDir, "$id.json").delete()
        changed()
        return existed
    }

    @Synchronized
    fun setEnabled(id: String, enabled: Boolean) {
        if (!ManifestValidator.isValidId(id) || !File(pluginsDir, id).isDirectory) return
        val f = File(metaDir, "$id.json")
        f.writeText(readJson(f).put("enabled", enabled).toString())
        changed()
    }

    /** Returns the stored JSON text for [key], or "null". */
    @Synchronized
    fun storageGet(id: String, key: String): String {
        if (!ManifestValidator.isValidId(id)) return "null"
        val v = readJson(File(kvDir, "$id.json")).opt(key)
        return if (v == null || v === JSONObject.NULL) "null" else wrap(v)
    }

    @Synchronized
    fun storageSet(id: String, key: String, valueJson: String) {
        if (!ManifestValidator.isValidId(id)) return
        val f = File(kvDir, "$id.json")
        val kv = readJson(f)
        val v = try { org.json.JSONTokener(valueJson).nextValue() } catch (_: Exception) { valueJson }
        if (v == null || v === JSONObject.NULL) kv.remove(key) else kv.put(key, v)
        if (kv.toString().length > 1_000_000) throw PluginException("plugin storage quota exceeded")
        f.writeText(kv.toString())
    }

    private fun wrap(v: Any): String = when (v) {
        is String -> JSONObject.quote(v)
        else -> v.toString()
    }

    private fun readJson(f: File): JSONObject = try { if (f.isFile) JSONObject(f.readText()) else JSONObject() } catch (_: Exception) { JSONObject() }

    /**
     * Downloads [url] (optionally with a bearer token), verifies sha256 and installs. Blocking; call
     * from a background thread. Throws [PluginException] with a reason on failure.
     */
    fun installFromUrl(http: OkHttpClient, url: String, token: String, sha256: String?, maxBytes: Long = 64L * 1024 * 1024): JSONObject {
        val rb = Request.Builder().url(url)
        if (token.isNotEmpty()) rb.header("Authorization", "Bearer $token")
        val tmp = File.createTempFile("plugin-dl", ".yplug", filesDir)
        try {
            http.newCall(rb.build()).execute().use { resp ->
                if (!resp.isSuccessful) throw PluginException("download failed: HTTP ${resp.code}")
                val body = resp.body ?: throw PluginException("empty response")
                val md = MessageDigest.getInstance("SHA-256")
                var total = 0L
                body.byteStream().use { ins ->
                    tmp.outputStream().use { os ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val n = ins.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > maxBytes) throw PluginException("download exceeds size limit")
                            md.update(buf, 0, n); os.write(buf, 0, n)
                        }
                    }
                }
                val actual = hex(md.digest())
                if (!sha256.isNullOrEmpty() && !actual.equals(sha256, ignoreCase = true))
                    throw PluginException("sha256 mismatch (expected $sha256, got $actual)")
            }
            return tmp.inputStream().use { install(it) }
        } catch (e: PluginException) { throw e
        } catch (e: Exception) { throw PluginException("download failed: ${e.message}")
        } finally { tmp.delete() }
    }

    companion object {
        fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }
    }
}
