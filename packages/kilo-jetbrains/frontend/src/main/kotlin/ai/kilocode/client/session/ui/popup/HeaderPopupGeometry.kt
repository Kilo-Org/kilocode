package ai.kilocode.client.session.ui.popup

import com.intellij.openapi.ui.popup.Balloon
import java.awt.Rectangle

/**
 * Where a header popup should sit relative to its card, and how large its body may be.
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
 * Header popups only ever sit beside their card, never over it and never above or below it. The fit part
 * is not cosmetic: `BalloonImpl.show` silently re-points a balloon to `BELOW`/`ABOVE` when the
 * requested rectangle does not fit inside the layered pane, so a body that overflows its side would
 * land in exactly the placement we are avoiding. Capping the body keeps the requested position.
 */
internal object HeaderPopupGeometry {

    /**
     * Picks the side of [card] with more room inside [pane] and the body box that fits there.
     *
     * The pointer lands on the edge of [card], the collapsible view the popup belongs to, so the
     * balloon reads as attached to that card instead of docked to the far edge of the session. Room
     * is still measured against [pane]: a card is narrower than the session, and cards near the
     * middle of a split editor have almost no room beside them inside the session itself.
     *
     * [view] is the visible session and only budgets height. Using [card] there would collapse the
     * body, since a collapsed card header is a couple of rows tall.
     */
    fun beside(pane: Rectangle, card: Rectangle, view: Rectangle, fit: HeaderPopupFit): HeaderPopupPlacement {
        val left = (card.x - pane.x).coerceAtLeast(0)
        val right = (pane.x + pane.width - (card.x + card.width)).coerceAtLeast(0)
        // Ties go right: it matches reading direction and the common tool-window-on-the-left setup.
        val useRight = right >= left
        val room = (if (useRight) right else left) - fit.chromeWidth - fit.gap
        return HeaderPopupPlacement(
            position = if (useRight) Balloon.Position.atRight else Balloon.Position.atLeft,
            x = if (useRight) card.x + card.width else card.x,
            maxWidth = room.coerceIn(0, fit.maxWidth),
            // Height is budgeted against the session, not the pane: the popup belongs to the session
            // view, so it must not run past it into editor tabs or neighbouring tool windows.
            maxHeight = (view.height - fit.gap * 2 - fit.chromeHeight).coerceIn(0, fit.maxHeight),
        )
    }

    /**
     * Vertical pointer target for a body of [height], preferring [y] but keeping the balloon inside
     * [view]. The balloon centres its body on the target, so an unclamped target near an edge would
     * overflow and trigger the same re-pointing that [beside] avoids horizontally.
     */
    fun centerY(view: Rectangle, y: Int, height: Int, gap: Int): Int {
        val half = height / 2
        val top = view.y + gap + half
        val bottom = view.y + view.height - gap - half
        if (bottom < top) return view.y + view.height / 2
        return y.coerceIn(top, bottom)
    }
}
