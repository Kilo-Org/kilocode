package ai.kilocode.client.session.ui.rail

import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle

/**
 * Geometry for the navigator balloon, which is shown without a callout.
 *
 * A pointerless balloon is placed differently from a pointed one. `BalloonImpl.getUpdatedBounds` uses
 * the requested [com.intellij.openapi.ui.popup.Balloon.Position] and `cornerToPointerDistance` only
 * when the pointer is shown; with the callout off it centers the content box on the target point and
 * ignores both. So the caller cannot ask for "left of the rail" — it has to hand the platform the
 * center that puts the box there, which is what [center] computes.
 *
 * All values are already-scaled device px, in the layered pane's coordinate space, whose left edge is 0.
 */
internal object PromptRailPlacement {
    /**
     * Largest body that fits between the window's left [margin] and the rail, whose left edge is [railX]
     * and against which the card sits [inset] short.
     */
    fun maxWidth(railX: Int, inset: Int, margin: Int, chrome: Int, cap: Int): Int =
        (railX - inset - margin - chrome).coerceIn(0, cap)

    /** Largest body that fits in [height] of visible session, keeping [margin] above and below. */
    fun maxHeight(height: Int, margin: Int, chrome: Int, cap: Int): Int =
        (height - margin * 2 - chrome).coerceIn(0, cap)

    /**
     * Center to hand the platform so the [content] box ends [inset] left of [railX].
     *
     * The navigator passes `inset = 0`, putting the card hard against the rail. Any gap there is dead
     * space: the pointer crossing it is over neither the card nor the ticks, which drops the controller's
     * on-subject flag and starts the hide timer, so the card closes on the way to a tick. Flush also
     * requires the balloon's shadow to be off, since that shadow is reserved outside the border box and
     * is hit-testable, and would otherwise cover the ticks with an invisible margin.
     *
     * [anchorY] is the center the balloon should sit on, clamped by [margin] to keep the box inside
     * [area], the visible session. It is the center of the rail rather than of the hovered tick, so the
     * balloon holds still while the pointer travels down the ticks.
     */
    fun center(railX: Int, area: Rectangle, inset: Int, margin: Int, content: Dimension, anchorY: Int): Point {
        val x = railX - inset - content.width / 2
        val min = area.y + margin + content.height / 2
        val max = area.y + area.height - margin - content.height / 2
        // A body taller than the room it was budgeted for can only be centered.
        val y = if (max < min) area.y + area.height / 2 else anchorY.coerceIn(min, max)
        return Point(x, y)
    }

    /**
     * The box the platform lays out around [center] for a [content]-sized pointerless balloon, mirroring
     * `BalloonImpl.getUpdatedBounds`. Excludes the shadow, which is added outside this rect.
     */
    fun box(center: Point, content: Dimension): Rectangle = Rectangle(
        center.x - content.width / 2,
        center.y - content.height / 2,
        content.width,
        content.height,
    )
}
