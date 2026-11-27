package ai.kilocode.client.ui.popup

import com.intellij.openapi.ui.popup.Balloon
import java.awt.Rectangle

/**
 * Where a side popup should sit relative to its subject, and how large its body may be.
 *
 * [x] is the pointer target in the same coordinate space the placement was computed in.
 */
internal data class SidePopupPlacement(
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
 * against the pane edges, and [maxWidth]/[maxHeight] are the caps the surface allows.
 */
internal data class SidePopupFit(
    val chromeWidth: Int,
    val chromeHeight: Int,
    val gap: Int,
    val maxWidth: Int,
    val maxHeight: Int,
)

/** Vertical pointer target and the distance from the balloon top to that target. */
internal data class SidePopupAim(val y: Int, val distance: Int)

/**
 * Geometry for popups that sit beside the thing they describe. Pure functions so the side and fit rules
 * are testable without a frame.
 *
 * These popups only ever sit beside their subject, never over it and never above or below it. The fit
 * part is not cosmetic: `BalloonImpl.show` silently re-points a balloon to `BELOW`/`ABOVE` when the
 * requested rectangle does not fit inside the layered pane, so a body that overflows its side would land
 * in exactly the placement we are avoiding. Capping the body keeps the requested position.
 */
internal object SidePopupGeometry {

    /**
     * Picks the side of [subject] with more room inside [pane] and the body box that fits there.
     *
     * The pointer lands on the edge of [subject] — the card or row the popup belongs to — so the balloon
     * reads as attached to that element instead of docked to the far edge of the surface. Room is still
     * measured against [pane]: a card or row is narrower than its surface, and one near the middle of a
     * split editor has almost no room beside it inside the surface itself.
     *
     * [view] is the visible surface and only budgets height. Using [subject] there would collapse the
     * body, since a collapsed card header or a list row is a couple of rows tall.
     */
    fun beside(pane: Rectangle, subject: Rectangle, view: Rectangle, fit: SidePopupFit): SidePopupPlacement {
        val left = (subject.x - pane.x).coerceAtLeast(0)
        val right = (pane.x + pane.width - (subject.x + subject.width)).coerceAtLeast(0)
        // Ties go right: it matches reading direction and the common tool-window-on-the-left setup.
        val useRight = right >= left
        val room = (if (useRight) right else left) - fit.chromeWidth - fit.gap
        return SidePopupPlacement(
            position = if (useRight) Balloon.Position.atRight else Balloon.Position.atLeft,
            x = if (useRight) subject.x + subject.width else subject.x,
            maxWidth = room.coerceIn(0, fit.maxWidth),
            // Height is budgeted against the surface, not the pane: the popup belongs to that surface, so
            // it must not run past it into editor tabs or neighbouring tool windows.
            maxHeight = (view.height - fit.gap * 2 - fit.chromeHeight).coerceIn(0, fit.maxHeight),
        )
    }

    /**
     * Keeps the pointer on [subject] while moving the balloon body into [view]. The returned [distance]
     * is the value the platform uses as `cornerToPointerDistance`, which makes the body slide without
     * moving the pointer target off the element it describes.
     */
    fun aim(view: Rectangle, subject: Rectangle, y: Int, height: Int, gap: Int, indent: Int): SidePopupAim {
        val hit = subject.intersection(view)
        if (hit.isEmpty) return fallback(view, height, gap, indent)
        val pointer = clamp(y, hit.y + indent, hit.y + hit.height - indent)
        val top = top(view, pointer, height, gap)
        return SidePopupAim(y = pointer, distance = legal(pointer - top, height, indent))
    }

    private fun fallback(view: Rectangle, height: Int, gap: Int, indent: Int): SidePopupAim {
        val y = view.y + view.height / 2
        val top = top(view, y, height, gap)
        return SidePopupAim(y = y, distance = legal(y - top, height, indent))
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
