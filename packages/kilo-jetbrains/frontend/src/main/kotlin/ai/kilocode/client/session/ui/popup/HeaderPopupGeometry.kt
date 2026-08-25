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
 * Vertical pointer target and the distance from the balloon top to that target.
 */
internal data class HeaderPopupAim(val y: Int, val distance: Int)

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
     * Keeps the pointer on [card] while moving the balloon body into [view]. The returned [distance]
     * is the value the platform uses as `cornerToPointerDistance`, which makes the body slide without
     * moving the pointer target off the element it describes.
     */
    fun aim(view: Rectangle, card: Rectangle, y: Int, height: Int, gap: Int, indent: Int): HeaderPopupAim {
        val hit = card.intersection(view)
        if (hit.isEmpty) return fallback(view, height, gap, indent)
        val pointer = clamp(y, hit.y + indent, hit.y + hit.height - indent)
        val top = top(view, pointer, height, gap)
        return HeaderPopupAim(y = pointer, distance = legal(pointer - top, height, indent))
    }

    private fun fallback(view: Rectangle, height: Int, gap: Int, indent: Int): HeaderPopupAim {
        val y = view.y + view.height / 2
        val top = top(view, y, height, gap)
        return HeaderPopupAim(y = y, distance = legal(y - top, height, indent))
    }

    private fun top(view: Rectangle, y: Int, height: Int, gap: Int): Int {
        val min = view.y + gap
        val max = view.y + view.height - gap - height
        if (max < min) return view.y + (view.height - height) / 2
        return (y - height / 2).coerceIn(min, max)
    }

    private fun legal(distance: Int, height: Int, indent: Int): Int {
        val max = height - indent
        if (max < indent) return height / 2
        return distance.coerceIn(indent, max)
    }

    private fun clamp(value: Int, min: Int, max: Int): Int {
        if (max < min) return min + (max - min) / 2
        return value.coerceIn(min, max)
    }
}
