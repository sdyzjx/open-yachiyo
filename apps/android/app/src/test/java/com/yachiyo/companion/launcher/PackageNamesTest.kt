package com.yachiyo.companion.launcher

import org.junit.Assert.*
import org.junit.Test

class PackageNamesTest {
    @Test fun validPackages() {
        assertTrue(PackageNames.isValid("com.android.chrome"))
        assertTrue(PackageNames.isValid("org.lineageos.jelly"))
        assertFalse(PackageNames.isValid("nodots"))
        assertFalse(PackageNames.isValid("../../x.y"))
        assertFalse(PackageNames.isValid("a.b/c"))
    }

    @Test fun iconPath() {
        assertEquals("com.foo.bar", PackageNames.fromIconPath("com.foo.bar.png"))
        assertEquals("com.foo.bar", PackageNames.fromIconPath("/com.foo.bar.png"))
        assertNull(PackageNames.fromIconPath("com.foo.bar"))
        assertNull(PackageNames.fromIconPath("../a.png"))
    }
}
