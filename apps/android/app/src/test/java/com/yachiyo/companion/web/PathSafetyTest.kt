package com.yachiyo.companion.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.file.Files

class PathSafetyTest {
    @Test fun insideRootResolves() {
        val root = Files.createTempDirectory("ps").toFile()
        assertNotNull(PathSafety.resolveInside(root, "a/b.txt"))
        assertNotNull(PathSafety.resolveInside(root, "/a/b.txt"))
    }

    @Test fun traversalRejected() {
        val root = Files.createTempDirectory("ps").toFile()
        assertNull(PathSafety.resolveInside(root, "../x"))
        assertNull(PathSafety.resolveInside(root, "a/../../x"))
    }

    @Test fun mimeGuess() {
        assertEquals("application/javascript", MimeTypes.guess("a.mjs"))
        assertEquals("application/wasm", MimeTypes.guess("a.wasm"))
        assertEquals("application/octet-stream", MimeTypes.guess("x.unknown"))
    }
}
