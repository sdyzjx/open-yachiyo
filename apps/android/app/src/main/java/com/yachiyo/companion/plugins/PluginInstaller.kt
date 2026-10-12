package com.yachiyo.companion.plugins

import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.zip.ZipInputStream

/** Extracts and installs `.yplug`/`.zip` packages into `<pluginsDir>/<id>/` (contract C3.1). */
class PluginInstaller(
    private val pluginsDir: File,
    private val maxEntries: Int = 2000,
    private val maxTotalBytes: Long = 64L * 1024 * 1024
) {
    /** Returns the validated manifest. Existing install of the same id is replaced atomically-ish. */
    fun install(zip: InputStream): JSONObject {
        pluginsDir.mkdirs()
        val tmp = File(pluginsDir, ".tmp-" + UUID.randomUUID())
        tmp.mkdirs()
        try {
            extract(zip, tmp)
            val mf = File(tmp, "manifest.json")
            if (!mf.isFile) throw PluginException("manifest.json missing at package root")
            val raw = try { JSONObject(mf.readText()) } catch (e: Exception) { throw PluginException("manifest.json is not valid JSON") }
            val manifest = ManifestValidator.validate(raw)
            val entry = manifest.getString("entry")
            if (PathCheck.inside(tmp, entry)?.isFile != true) throw PluginException("entry '$entry' not found in package")
            // persist the normalized manifest (so readers can trust defaults)
            mf.writeText(manifest.toString())

            val id = manifest.getString("id")
            val dest = File(pluginsDir, id)
            val old = File(pluginsDir, ".old-" + UUID.randomUUID())
            if (dest.exists() && !dest.renameTo(old)) throw PluginException("cannot replace existing install")
            if (!tmp.renameTo(dest)) {
                if (old.exists()) old.renameTo(dest)
                throw PluginException("cannot move package into place")
            }
            old.deleteRecursively()
            return manifest
        } catch (e: PluginException) {
            tmp.deleteRecursively(); throw e
        } catch (e: Exception) {
            tmp.deleteRecursively(); throw PluginException("install failed: ${e.message}")
        }
    }

    private fun extract(input: InputStream, dest: File) {
        var entries = 0
        var total = 0L
        ZipInputStream(input).use { zin ->
            while (true) {
                val e = zin.nextEntry ?: break
                if (++entries > maxEntries) throw PluginException("too many entries")
                val name = e.name
                if (name.contains('\\') || name.startsWith("/") || name.contains('\u0000'))
                    throw PluginException("illegal entry name: $name")
                val target = PathCheck.inside(dest, name) ?: throw PluginException("path traversal in entry: $name")
                if (e.isDirectory) { target.mkdirs(); continue }
                target.parentFile?.mkdirs()
                target.outputStream().use { os ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = zin.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > maxTotalBytes) throw PluginException("package too large when extracted")
                        os.write(buf, 0, n)
                    }
                }
            }
        }
        if (entries == 0) throw PluginException("empty or invalid zip")
    }
}

internal object PathCheck {
    fun inside(root: File, rel: String): File? {
        val cr = root.canonicalFile
        val c = File(cr, rel).canonicalFile
        return if (c.path == cr.path || c.path.startsWith(cr.path + File.separator)) c else null
    }
}
