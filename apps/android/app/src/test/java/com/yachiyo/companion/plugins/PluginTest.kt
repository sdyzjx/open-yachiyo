package com.yachiyo.companion.plugins

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class PluginTest {
    private fun zip(vararg files: Pair<String, String>): ByteArray {
        val bo = ByteArrayOutputStream()
        ZipOutputStream(bo).use { z ->
            for ((n, c) in files) { z.putNextEntry(ZipEntry(n)); z.write(c.toByteArray()); z.closeEntry() }
        }
        return bo.toByteArray()
    }

    private fun manifest(id: String = "com.example.pomo", extra: String = "") =
        """{"id":"$id","name":"Pomodoro","version":"1.0.0","type":"app","sdk":1$extra}"""

    private fun mgr() = PluginManager(Files.createTempDirectory("pm").toFile(), clock = { 1234L })

    // ---- manifest -------------------------------------------------------------------------

    @Test fun manifestDefaultsApplied() {
        val m = ManifestValidator.validate(JSONObject(manifest()))
        assertEquals("index.html", m.getString("entry"))
        assertEquals(0, m.getJSONArray("permissions").length())
    }

    @Test fun widgetGetsDefaultsAndClamps() {
        val m = ManifestValidator.validate(JSONObject("""{"id":"abc","name":"W","version":"1","type":"widget","widget":{"w":99}}"""))
        assertEquals(12, m.getJSONObject("widget").getInt("w"))
        assertEquals(1, m.getJSONObject("widget").getInt("h"))
    }

    @Test fun manifestRejections() {
        fun bad(json: String) = try { ManifestValidator.validate(JSONObject(json)); fail("accepted $json") } catch (_: PluginException) {}
        bad("""{"id":"AB","name":"x","version":"1","type":"app"}""")
        bad("""{"id":"../evil","name":"x","version":"1","type":"app"}""")
        bad("""{"id":"abc","name":"","version":"1","type":"app"}""")
        bad("""{"id":"abc","name":"x","version":"1","type":"other"}""")
        bad("""{"id":"abc","name":"x","version":"1","type":"app","entry":"../x.html"}""")
        bad("""{"id":"abc","name":"x","version":"1","type":"app","entry":"/abs.html"}""")
        bad("""{"id":"abc","name":"x","version":"1","type":"app","sdk":2}""")
        bad("""{"id":"abc","name":"x","version":"1","type":"app","permissions":["root.access"]}""")
    }

    @Test fun permissionsAccepted() {
        val m = ManifestValidator.validate(JSONObject(manifest(extra = ""","permissions":["bus.publish:plugin.com.example.pomo.**","bus.subscribe:task.*","rpc.call:avatar.*","rpc.register","agent.tool"]""")))
        assertEquals(5, m.getJSONArray("permissions").length())
    }

    // ---- install --------------------------------------------------------------------------

    @Test fun installsAndLists() {
        val pm = mgr()
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "<html></html>", "js/a.js" to "1")))
        val l = pm.list()
        assertEquals(1, l.length())
        val p = l.getJSONObject(0)
        assertEquals("com.example.pomo", p.getString("id"))
        assertEquals("https://appassets.androidplatform.net/plugins/com.example.pomo/", p.getString("base_url"))
        assertEquals(1234L, p.getLong("installed_at")); assertTrue(p.getBoolean("enabled"))
        assertTrue(java.io.File(pm.pluginsDir, "com.example.pomo/js/a.js").isFile)
    }

    @Test fun zipSlipRejectedAndNothingInstalled() {
        val pm = mgr()
        try {
            pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "x", "../../evil.txt" to "pwn")))
            fail()
        } catch (_: PluginException) {}
        assertEquals(0, pm.list().length())
        assertFalse(java.io.File(pm.pluginsDir.parentFile.parentFile, "evil.txt").exists())
        assertEquals(0, pm.pluginsDir.listFiles()!!.size)   // temp dir cleaned
    }

    @Test fun absoluteAndBackslashEntriesRejected() {
        val pm = mgr()
        for (n in listOf("/etc/x", "a\\..\\b")) try {
            pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "x", n to "p"))); fail(n)
        } catch (_: PluginException) {}
    }

    @Test fun missingManifestOrEntryRejected() {
        val pm = mgr()
        try { pm.install(ByteArrayInputStream(zip("index.html" to "x"))); fail() } catch (_: PluginException) {}
        try { pm.install(ByteArrayInputStream(zip("manifest.json" to manifest()))); fail() } catch (_: PluginException) {}
        try { pm.install(ByteArrayInputStream("not a zip".toByteArray())); fail() } catch (_: PluginException) {}
    }

    @Test fun sizeLimitEnforced() {
        val dir = Files.createTempDirectory("lim").toFile()
        val inst = PluginInstaller(dir, maxTotalBytes = 100)
        try { inst.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "x".repeat(500)))); fail() }
        catch (e: PluginException) { assertTrue(e.message!!.contains("large")) }
    }

    @Test fun reinstallKeepsStorageAndReplacesFiles() {
        val pm = mgr()
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "v1", "old.txt" to "o")))
        pm.storageSet("com.example.pomo", "k", "\"hello\"")
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "v2")))
        assertEquals("\"hello\"", pm.storageGet("com.example.pomo", "k"))
        assertFalse(java.io.File(pm.pluginsDir, "com.example.pomo/old.txt").exists())
        assertEquals("v2", java.io.File(pm.pluginsDir, "com.example.pomo/index.html").readText())
    }

    @Test fun uninstallRemovesEverythingAndKvIsolated() {
        val pm = mgr()
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "x")))
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest("com.other.app"), "index.html" to "x")))
        pm.storageSet("com.example.pomo", "k", "{\"a\":1}")
        assertEquals("null", pm.storageGet("com.other.app", "k"))
        assertEquals("{\"a\":1}", pm.storageGet("com.example.pomo", "k"))
        assertTrue(pm.uninstall("com.example.pomo"))
        assertEquals(1, pm.list().length())
        assertEquals("null", pm.storageGet("com.example.pomo", "k"))
        assertFalse(pm.uninstall("../x"))
    }

    @Test fun enableToggle() {
        val pm = mgr()
        pm.install(ByteArrayInputStream(zip("manifest.json" to manifest(), "index.html" to "x")))
        pm.setEnabled("com.example.pomo", false)
        assertFalse(pm.list().getJSONObject(0).getBoolean("enabled"))
    }

    @Test fun storageKeyIdTraversalIgnored() {
        val pm = mgr()
        pm.storageSet("../evil", "k", "1")
        assertEquals("null", pm.storageGet("../evil", "k"))
    }

    // ---- download -------------------------------------------------------------------------

    @Test fun downloadVerifiesShaAndSendsToken() {
        val bytes = zip("manifest.json" to manifest(), "index.html" to "x")
        val sha = PluginManager.hex(MessageDigest.getInstance("SHA-256").digest(bytes))
        val srv = MockWebServer(); srv.enqueue(MockResponse().setBody(Buffer().write(bytes))); srv.enqueue(MockResponse().setBody(Buffer().write(bytes))); srv.start()
        try {
            val pm = mgr()
            val m = pm.installFromUrl(OkHttpClient(), srv.url("/p").toString(), "secret", sha)
            assertEquals("com.example.pomo", m.getString("id"))
            assertEquals("Bearer secret", srv.takeRequest().getHeader("Authorization"))
            try { pm.installFromUrl(OkHttpClient(), srv.url("/p").toString(), "", "0".repeat(64)); fail() }
            catch (e: PluginException) { assertTrue(e.message!!.contains("sha256")) }
        } finally { srv.shutdown() }
    }

    @Test fun downloadHttpErrorReported() {
        val srv = MockWebServer(); srv.enqueue(MockResponse().setResponseCode(404)); srv.start()
        try { mgr().installFromUrl(OkHttpClient(), srv.url("/x").toString(), "", null); fail() }
        catch (e: PluginException) { assertTrue(e.message!!.contains("404")) } finally { srv.shutdown() }
    }
}
