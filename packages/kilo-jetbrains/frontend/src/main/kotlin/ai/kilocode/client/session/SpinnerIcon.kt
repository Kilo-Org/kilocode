package ai.kilocode.client.session

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.ColorUtil
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.RoundRectangle2D
import javax.swing.Icon
import kotlin.math.cos

/**
 * Animated running badge that mirrors the VS Code Agent Manager spinner: a 4x4 grid of rounded
 * squares whose opacity pulses. Corners stay empty; the inner squares pulse brighter than the
 * outer ring. Painted in the neutral icon grey ([UiStyle.Colors.running]) so it carries the same
 * weight as the static row icons it stands in for.
 *
 * Built as a frame-based [com.intellij.ui.AnimatedIcon] so it animates automatically inside list
 * cell renderers that set `AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED` (see `ActiveListView`).
 */
internal object SpinnerIcon {
    private const val GRID = 4
    private const val COUNT = GRID * GRID

    // VS Code viewBox is 15 units: squares sit on a 4-unit pitch and are 3 units wide with a 1-unit
    // corner radius. We map those units onto a scaled 16px icon.
    private const val VIEWBOX = 15f
    private const val PITCH = 4f
    private const val SQUARE = 3f
    private const val RADIUS = 1f

    private const val FRAMES = 12
    private const val CYCLE_MS = 1200
    private val DELAY = CYCLE_MS / FRAMES

    // Corners read as noise at this size, so VS Code hides them.
    private val CORNERS = setOf(0, 3, 12, 15)
    private val INNER = setOf(5, 6, 9, 10)

    // Opacity range per group (VS Code: inner 0.4..1.0, outer ring 0.15..0.35).
    private const val INNER_LO = 0.4f
    private const val INNER_HI = 1.0f
    private const val OUTER_LO = 0.15f
    private const val OUTER_HI = 0.35f

    // Deterministic per-square phase (0..1) that scatters the pulse like VS Code's randomized delays.
    private val PHASE = floatArrayOf(
        0.00f, 0.15f, 0.62f, 0.00f,
        0.40f, 0.85f, 0.25f, 0.70f,
        0.10f, 0.55f, 0.30f, 0.90f,
        0.00f, 0.48f, 0.78f, 0.00f,
    )

    val icon: Icon = AnimatedIcon(DELAY, *Array(FRAMES) { Frame(it) })

    /** Ease-in-out 0..1..0 wave, matching CSS `ease-in-out` opacity pulses. */
    private fun ease(t: Float): Float = ((1f - cos(2.0 * Math.PI * t)) / 2.0).toFloat()

    private fun opacity(index: Int, frame: Int): Float {
        val lo = if (index in INNER) INNER_LO else OUTER_LO
        val hi = if (index in INNER) INNER_HI else OUTER_HI
        return lo + (hi - lo) * ease(PHASE[index] + frame.toFloat() / FRAMES)
    }

    private class Frame(private val frame: Int) : Icon {
        override fun getIconWidth() = JBUI.scale(16)

        override fun getIconHeight() = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                val scale = iconWidth / VIEWBOX
                val size = SQUARE * scale
                val arc = RADIUS * 2f * scale
                val base = color()
                for (i in 0 until COUNT) {
                    if (i in CORNERS) continue
                    g2.color = ColorUtil.withAlpha(base, opacity(i, frame).toDouble())
                    val px = (i % GRID) * PITCH * scale
                    val py = (i / GRID) * PITCH * scale
                    g2.fill(RoundRectangle2D.Float(px, py, size, size, arc, arc))
                }
            } finally {
                g2.dispose()
            }
        }
    }

    fun color() = UiStyle.Colors.running()
}
