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
     * Largest body that fits between the pane's left edge and [railX], the left edge of the rail.
     * A gap is kept on both sides, so the balloon clears the ticks and the window edge alike.
     */
    fun maxWidth(railX: Int, gap: Int, chrome: Int, cap: Int): Int =
        (railX - gap * 2 - chrome).coerceIn(0, cap)

    /** Largest body that fits in [height] of visible session, keeping a gap above and below. */
    fun maxHeight(height: Int, gap: Int, chrome: Int, cap: Int): Int =
        (height - gap * 2 - chrome).coerceIn(0, cap)

    /**
     * Center to hand the platform so the [content] box ends [gap] plus [shadow] left of [railX] — the
     * shadow is counted too, so nothing the balloon paints reaches the ticks. Vertically the box follows
     * the hovered tick at [tickY], clamped to keep it inside [area], the visible session.
     */
    fun center(railX: Int, area: Rectangle, gap: Int, shadow: Int, content: Dimension, tickY: Int): Point {
        val x = railX - gap - shadow - content.width / 2
        val min = area.y + gap + shadow + content.height / 2
        val max = area.y + area.height - gap - shadow - content.height / 2
        // A body taller than the room it was budgeted for can only be centered.
        val y = if (max < min) area.y + area.height / 2 else tickY.coerceIn(min, max)
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
