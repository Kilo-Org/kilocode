package ai.kilocode.client.session.ui.popup

import com.intellij.openapi.ui.popup.Balloon
import java.awt.Rectangle

/**
 * Where a header popup should sit relative to the session chat, and how large its body may be.
 *
 * [x] is the pointer target in the same coordinate space the placement was computed in.
 */
internal data class HeaderPopupPlacement(
    val position: Balloon.Position,
    val x: Int,
    val maxWidth: Int,
    val maxHeight: Int,
)

/**
 * Room the balloon needs beyond its body.
 *
 * [chromeWidth] and [chromeHeight] are what the balloon adds around its content on each axis (border
 * insets, pointer, and the drop shadow, which is the easy one to forget), [gap] is breathing room kept
 * against the pane edges, and [maxWidth]/[maxHeight] are the shared body caps.
 */
internal data class HeaderPopupFit(
    val chromeWidth: Int,
    val chromeHeight: Int,
    val gap: Int,
    val maxWidth: Int,
    val maxHeight: Int,
)

/**
 * Geometry for header popups. Pure functions so the side and fit rules are testable without a frame.
 *
 * Header popups only ever sit beside the chat, never over it and never above or below it. The fit part
 * is not cosmetic: `BalloonImpl.show` silently re-points a balloon to `BELOW`/`ABOVE` when the
 * requested rectangle does not fit inside the layered pane, so a body that overflows its side would
 * land in exactly the placement we are avoiding. Capping the body keeps the requested position.
 */
internal object HeaderPopupGeometry {

    /**
     * Picks the side of [chat] with more room inside [pane] and the body box that fits there.
     *
     * [pane] only decides which side has room; the body is bounded by [chat] so the popup stays
     * within the visible session view.
     */
    fun beside(pane: Rectangle, chat: Rectangle, fit: HeaderPopupFit): HeaderPopupPlacement {
        val left = (chat.x - pane.x).coerceAtLeast(0)
        val right = (pane.x + pane.width - (chat.x + chat.width)).coerceAtLeast(0)
        // Ties go right: it matches reading direction and the common tool-window-on-the-left setup.
        val useRight = right >= left
        val room = (if (useRight) right else left) - fit.chromeWidth - fit.gap
        return HeaderPopupPlacement(
            position = if (useRight) Balloon.Position.atRight else Balloon.Position.atLeft,
            x = if (useRight) chat.x + chat.width else chat.x,
            maxWidth = room.coerceIn(0, fit.maxWidth),
            // Height is budgeted against the chat, not the pane: the popup belongs to the session
            // view, so it must not run past it into editor tabs or neighbouring tool windows.
            maxHeight = (chat.height - fit.gap * 2 - fit.chromeHeight).coerceIn(0, fit.maxHeight),
        )
    }

    /**
     * Vertical pointer target for a body of [height], preferring [y] but keeping the balloon inside
     * [chat]. The balloon centres its body on the target, so an unclamped target near an edge would
     * overflow and trigger the same re-pointing that [beside] avoids horizontally.
     */
    fun centerY(chat: Rectangle, y: Int, height: Int, gap: Int): Int {
        val half = height / 2
        val top = chat.y + gap + half
        val bottom = chat.y + chat.height - gap - half
        if (bottom < top) return chat.y + chat.height / 2
        return y.coerceIn(top, bottom)
    }
}
