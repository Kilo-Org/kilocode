package ai.kilocode.client.session.ui

import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Insets
import java.awt.LayoutManager

/**
 * A vertical, width-aware layout manager for the session transcript.
 *
 * Standard Swing layout managers (BoxLayout, GridLayout, etc.) compute
 * preferred sizes independently of width, which breaks [JBHtmlPane]-backed
 * components: they report an incorrect height until their width is fixed.
 *
 * This layout:
 * 1. Uses the parent's *actual* width as the available width for all children.
 * 2. Calls `setSize(w, …)` on each child before reading `preferredSize.height`
 *    so that HTML components reflow and report the correct height.
 * 3. Applies layout-owned [pad] around the children.
 * 4. Stacks children top-to-bottom with a configurable [gap].
 * 5. Skips invisible children.
 *
 * Pair with [SessionLayoutPanel] (or any panel that implements [Scrollable]
 * with `getScrollableTracksViewportWidth = true`) so the viewport constrains
 * the panel width and the layout always has a valid width to work with.
 */
class SessionLayout(
    private val gap: Int = UiStyle.Gap.part(),
    private val pad: Insets = UiStyle.Insets.none(),
) : LayoutManager {

    override fun addLayoutComponent(name: String, comp: Component) = Unit
    override fun removeLayoutComponent(comp: Component) = Unit

    override fun preferredLayoutSize(parent: Container): Dimension {
        val ins = insets(parent)
        val w = maxOf(0, parent.width - ins.left - ins.right)
        var h = ins.top + ins.bottom
        var first = true
        for (comp in parent.components) {
            if (!comp.isVisible) continue
            if (!first) h += gap
            first = false
            val child = bounds(ins, w, comp)
            // Pre-size to available width so HTML panes reflow before we measure
            comp.setSize(child.width, comp.height.coerceAtLeast(1))
            h += comp.preferredSize.height
        }
        return JBDimension(w + ins.left + ins.right, h)
    }

    override fun minimumLayoutSize(parent: Container): Dimension = preferredLayoutSize(parent)

    override fun layoutContainer(parent: Container) {
        val ins = insets(parent)
        val w = maxOf(0, parent.width - ins.left - ins.right)
        var y = ins.top
        var first = true
        for (comp in parent.components) {
            if (!comp.isVisible) continue
            if (!first) y += gap
            first = false
            val child = bounds(ins, w, comp)
            // Fix width first so HTML reflows, then read the resulting height
            comp.setSize(child.width, comp.height.coerceAtLeast(1))
            val h = comp.preferredSize.height
            comp.setBounds(child.left, y, child.width, h)
            y += h
        }
    }

    private fun bounds(ins: Insets, width: Int, comp: Component): Bounds {
        val view = comp as? SessionView ?: return Bounds(ins.left, width)
        if (view.sessionViewKind != SessionView.Kind.UserPrompt) return Bounds(ins.left, width)
        val shift = UiStyle.Insets.userPrompt()
        val next = width - shift
        if (next < UiStyle.Size.userPromptMin()) return Bounds(ins.left, width)
        return Bounds(ins.left + shift, next)
    }

    private fun insets(parent: Container): Insets {
        val base = parent.insets
        return Insets(
            base.top + pad.top,
            base.left + pad.left,
            base.bottom + pad.bottom,
            base.right + pad.right,
        )
    }

    private data class Bounds(val left: Int, val width: Int)
}

/**
 * A panel pre-configured with [SessionLayout] and the [Scrollable] interface.
 *
 * Setting `getScrollableTracksViewportWidth = true` tells the enclosing
 * [JScrollPane] to force the panel's width to match the viewport, giving
 * [SessionLayout] a valid width to measure against.
 */
open class SessionLayoutPanel(
    gap: Int = UiStyle.Gap.part(),
    pad: Insets = UiStyle.Insets.none(),
) : BorderLayoutPanel(), javax.swing.Scrollable {
    init {
        layout = SessionLayout(gap, pad)
    }

    override fun getScrollableTracksViewportWidth() = true
    override fun getScrollableTracksViewportHeight() = false
    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize
    override fun getScrollableUnitIncrement(
        visibleRect: java.awt.Rectangle,
        @Suppress("UNUSED_PARAMETER") orientation: Int,
        @Suppress("UNUSED_PARAMETER") direction: Int,
    ): Int = UiStyle.Gap.scroll()
    override fun getScrollableBlockIncrement(
        visibleRect: java.awt.Rectangle,
        @Suppress("UNUSED_PARAMETER") orientation: Int,
        @Suppress("UNUSED_PARAMETER") direction: Int,
    ): Int = visibleRect.height
}
