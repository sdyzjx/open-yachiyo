package com.yachiyo.companion.bridge

import org.junit.Assert.*
import org.junit.Test

class ImeMetricsTest {
    @Test fun hiddenKeyboardReportsZero() {
        val s = ImeMetrics.compute(0, false, 1920, 1920, 3f)
        assertEquals(ImeState(false, 0, 0), s)
    }

    @Test fun insetsDriveHeightAndConvertToCssPixels() {
        val s = ImeMetrics.compute(840, true, 1920, 1920, 3f)
        assertEquals(ImeState(true, 840, 280), s)
    }

    @Test fun staleInsetWhileInvisibleIsIgnored() {
        assertFalse(ImeMetrics.compute(840, false, 1920, 1920, 3f).visible)
    }

    @Test fun visibleFrameFallbackWhenInsetsAreNotDelivered() {
        val s = ImeMetrics.compute(0, false, 1920, 1080, 3f)
        assertEquals(ImeState(true, 840, 280), s)
    }

    @Test fun smallFrameChangesAreNotAKeyboard() {
        assertFalse(ImeMetrics.compute(0, false, 1920, 1800, 3f).visible)
    }
}
