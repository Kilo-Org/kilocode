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
     *
     * [chrome] must include the drop shadow on both sides even though the shadow is allowed to fall
     * inside the gap: the platform runs `ScreenUtil.moveToFit` on the shadowed rect, so a body sized to
     * the border box alone would be nudged back to the right, over the ticks.
     */
    fun maxWidth(railX: Int, gap: Int, chrome: Int, cap: Int): Int =
        (railX - gap * 2 - chrome).coerceIn(0, cap)

    /** Largest body that fits in [height] of visible session, keeping a gap above and below. */
    fun maxHeight(height: Int, gap: Int, chrome: Int, cap: Int): Int =
        (height - gap * 2 - chrome).coerceIn(0, cap)

    /**
     * Center to hand the platform so the [content] box ends exactly [gap] left of [railX], giving the
     * balloon the same breathing room against the ticks that the rail itself keeps against the scroll
     * pane. The shadow is deliberately not counted here — it is translucent and reaches into that gap,
     * and reserving it as well pushed the balloon a full shadow width away from the rail.
     *
     * [anchorY] is the center the balloon should sit on, clamped to keep the box inside [area], the
     * visible session. It is the center of the rail rather than of the hovered tick, so the balloon holds
     * still while the pointer travels down the ticks.
     */
    fun center(railX: Int, area: Rectangle, gap: Int, content: Dimension, anchorY: Int): Point {
        val x = railX - gap - content.width / 2
        val min = area.y + gap + content.height / 2
        val max = area.y + area.height - gap - content.height / 2
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
