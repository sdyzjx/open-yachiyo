package com.yachiyo.companion.bridge

/** Soft-keyboard geometry reported to the Web layer as the `ime` event (contract C2.2). */
data class ImeState(val visible: Boolean, val heightPx: Int, val heightCss: Int)

object ImeMetrics {
    /** Frame-based fallback is only trusted above this fraction of the screen (filters nav/status bar changes). */
    const val MIN_FRAME_FRACTION = 0.15f

    /**
     * @param insetBottomPx bottom of `WindowInsetsCompat.Type.ime()` (0 when unknown / hidden)
     * @param insetVisible `isVisible(Type.ime())`
     * @param screenHeightPx full window height
     * @param visibleBottomPx bottom of `getWindowVisibleDisplayFrame` (fallback when insets are not delivered)
     */
    fun compute(insetBottomPx: Int, insetVisible: Boolean, screenHeightPx: Int, visibleBottomPx: Int, density: Float): ImeState {
        var px = if (insetVisible) insetBottomPx.coerceAtLeast(0) else 0
        if (px == 0 && screenHeightPx > 0 && visibleBottomPx > 0) {
            val diff = screenHeightPx - visibleBottomPx
            if (diff > screenHeightPx * MIN_FRAME_FRACTION) px = diff
        }
        val css = if (density > 0f) Math.round(px / density) else px
        return ImeState(px > 0, px, css)
    }
}
