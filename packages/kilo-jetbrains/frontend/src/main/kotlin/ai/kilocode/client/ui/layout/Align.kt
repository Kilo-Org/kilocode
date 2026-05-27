package ai.kilocode.client.ui.layout

import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.LayoutManager2
import javax.swing.JPanel

enum class HAlign { TRACK, FIT, LEFT, CENTER, RIGHT }
enum class VAlign { TRACK, FIT, TOP, CENTER, BOTTOM }

/**
 * A transparent wrapper panel that positions its single child according to independent
 * horizontal ([h]) and vertical ([v]) alignment modes.
 *
 * **TRACK**: child fills all available space on that axis, ignoring child min/preferred/max.
 * The wrapper reports zero contribution from the child on that axis for its own min/preferred/max.
 *
 * **FIT**: child fills available space clamped to child's effective [min, max] range.
 *
 * **LEFT / CENTER / RIGHT** (horizontal) and **TOP / CENTER / BOTTOM** (vertical):
 * child uses its bounded preferred size (coerced into [min, max]) and is placed at the
 * corresponding edge or centered. Shrinks to available space when necessary.
 *
 * During layout, the child is first sized on TRACK/FIT axes before preferred size
 * is read. This mirrors Swing layouts such as [java.awt.BorderLayout] where the
 * parent axis is constrained, while preserving ordinary preferred-size behavior
 * for edge/center axes.
 *
 * Wrapper min/preferred/max sizes are computed by combining the per-axis child contribution
 * (zero for TRACK axes) with the panel insets.
 *
 * Use the factory extension for concise call sites:
 * ```
 * label.align(HAlign.CENTER, VAlign.CENTER)
 * button.align(HAlign.RIGHT, VAlign.CENTER)
 * panel.align(HAlign.LEFT, VAlign.TOP)
 * scrollable.align(HAlign.TRACK, VAlign.TOP)
 * ```
 */
class Align(
    child: Component,
    h: HAlign = HAlign.FIT,
    v: VAlign = VAlign.FIT,
) : JPanel(Layout(h, v)) {

    init {
        isOpaque = false
        add(child)
    }

    private class Layout(
        private val h: HAlign,
        private val v: VAlign,
    ) : LayoutManager2 {

        override fun addLayoutComponent(comp: Component, constraints: Any?) = Unit
        override fun addLayoutComponent(name: String?, comp: Component) = Unit
        override fun removeLayoutComponent(comp: Component) = Unit

        override fun layoutContainer(parent: Container) {
            if (parent.componentCount == 0) return
            val child = parent.getComponent(0)
            val ins = parent.insets
            val availW = maxOf(0, parent.width - ins.left - ins.right)
            val availH = maxOf(0, parent.height - ins.top - ins.bottom)

            val min = child.minimumSize
            val max = child.maximumSize
            if (probes(h) || probes(v)) {
                child.setSize(
                    if (probes(h)) probe(h, availW, min.width, max.width) else child.width,
                    if (probes(v)) probe(v, availH, min.height, max.height) else child.height,
                )
            }
            val pref = child.preferredSize

            val (w, cx) = place(h, availW, min.width, pref.width, max.width)
            val (ht, cy) = place(v, availH, min.height, pref.height, max.height)

            child.setBounds(ins.left + cx, ins.top + cy, w, ht)
        }

        override fun minimumLayoutSize(parent: Container): Dimension {
            if (parent.componentCount == 0) return Dimension(0, 0)
            val child = parent.getComponent(0)
            val ins = parent.insets
            val cw = if (h == HAlign.TRACK) 0 else child.minimumSize.width
            val ch = if (v == VAlign.TRACK) 0 else child.minimumSize.height
            return Dimension(cw + ins.left + ins.right, ch + ins.top + ins.bottom)
        }

        override fun preferredLayoutSize(parent: Container): Dimension {
            if (parent.componentCount == 0) return Dimension(0, 0)
            val child = parent.getComponent(0)
            val ins = parent.insets
            val min = child.minimumSize
            val max = child.maximumSize
            val availW = maxOf(0, parent.width - ins.left - ins.right)
            val availH = maxOf(0, parent.height - ins.top - ins.bottom)
            if ((availW > 0 && probes(h)) || (availH > 0 && probes(v))) {
                child.setSize(
                    if (availW > 0 && probes(h)) probe(h, availW, min.width, max.width) else child.width,
                    if (availH > 0 && probes(v)) probe(v, availH, min.height, max.height) else child.height,
                )
            }
            val pref = child.preferredSize
            val cw = if (h == HAlign.TRACK) 0 else bounded(pref.width, min.width, max.width)
            val ch = if (v == VAlign.TRACK) 0 else bounded(pref.height, min.height, max.height)
            return Dimension(cw + ins.left + ins.right, ch + ins.top + ins.bottom)
        }

        override fun maximumLayoutSize(target: Container): Dimension {
            if (target.componentCount == 0) return Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
            val child = target.getComponent(0)
            val ins = target.insets
            val cw = if (h == HAlign.TRACK) {
                Int.MAX_VALUE
            } else {
                maxOf(child.minimumSize.width, child.maximumSize.width) + ins.left + ins.right
            }
            val ch = if (v == VAlign.TRACK) {
                Int.MAX_VALUE
            } else {
                maxOf(child.minimumSize.height, child.maximumSize.height) + ins.top + ins.bottom
            }
            return Dimension(cw, ch)
        }

        override fun getLayoutAlignmentX(target: Container) = 0.5f
        override fun getLayoutAlignmentY(target: Container) = 0.5f
        override fun invalidateLayout(target: Container) = Unit
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns (size, offset) for a single axis. Offset is relative to the inner origin (after insets).
 * - TRACK: size = avail, offset = 0
 * - FIT: size = clamp(avail, min, max), offset = 0
 * - edge/center: size = clamp(boundedPref, 0, avail), offset positions according to alignment
 */
private fun place(mode: Any, avail: Int, min: Int, pref: Int, max: Int): Pair<Int, Int> {
    val effMax = maxOf(min, max)
    return when (mode) {
        HAlign.TRACK, VAlign.TRACK -> avail to 0
        HAlign.FIT, VAlign.FIT -> {
            // fill available, capped at effMax; if avail < min we still shrink to avail
            val size = minOf(avail, effMax)
            size to 0
        }
        HAlign.LEFT, VAlign.TOP -> {
            val size = minOf(bounded(pref, min, effMax), avail)
            size to 0
        }
        HAlign.CENTER, VAlign.CENTER -> {
            val size = minOf(bounded(pref, min, effMax), avail)
            size to (avail - size) / 2
        }
        HAlign.RIGHT, VAlign.BOTTOM -> {
            val size = minOf(bounded(pref, min, effMax), avail)
            size to (avail - size)
        }
        else -> avail to 0
    }
}

private fun bounded(value: Int, min: Int, max: Int) = value.coerceIn(min, maxOf(min, max))

private fun probes(mode: Any) = mode == HAlign.TRACK || mode == HAlign.FIT || mode == VAlign.TRACK || mode == VAlign.FIT

private fun probe(mode: Any, avail: Int, min: Int, max: Int): Int {
    if (mode == HAlign.FIT || mode == VAlign.FIT) return minOf(avail, maxOf(min, max))
    return avail
}

// ---------------------------------------------------------------------------
// Factory extension
// ---------------------------------------------------------------------------

fun Component.align(h: HAlign, v: VAlign) = Align(this, h, v)
