package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Insets
import java.awt.LayoutManager
import java.util.IdentityHashMap

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
 * 3. Applies layout-owned padding around the children.
 * 4. Stacks children top-to-bottom with a configurable gap.
 * 5. Skips invisible children.
 *
 * Pair with [SessionLayoutPanel] (or any panel that implements [Scrollable]
 * with `getScrollableTracksViewportWidth = true`) so the viewport constrains
 * the panel width and the layout always has a valid width to work with.
 */
class SessionLayout(
    private val baseGap: Int = SessionUiStyle.SessionLayout.GAP,
    private val basePad: Insets = JBUI.emptyInsets(),
) : LayoutManager {

    private val cache = IdentityHashMap<Component, Measured>()

    override fun addLayoutComponent(name: String, comp: Component) = Unit
    override fun removeLayoutComponent(comp: Component) {
        cache.remove(comp)
    }

    override fun preferredLayoutSize(parent: Container): Dimension {
        val ins = insets(parent)
        val w = maxOf(0, parent.width - ins.left - ins.right)
        var h = ins.top + ins.bottom
        var first = true
        for (comp in parent.components) {
            if (!comp.isVisible) continue
            if (!first) h += gap(comp)
            first = false
            val child = bounds(ins, w, comp)
            h += measure(comp, child.width)
        }
        // w and h are already scaled px (child preferred heights + scaled gaps/insets) and
        // match what layoutContainer stacks, so return a plain Dimension. A JBDimension would
        // scale again by the user scale factor and inflate the transcript height under IDE zoom.
        return Dimension(w + ins.left + ins.right, h)
    }

    override fun minimumLayoutSize(parent: Container): Dimension = preferredLayoutSize(parent)

    override fun layoutContainer(parent: Container) {
        val ins = insets(parent)
        val w = maxOf(0, parent.width - ins.left - ins.right)
        var y = ins.top
        var first = true
        for (comp in parent.components) {
            if (!comp.isVisible) continue
            if (!first) y += gap(comp)
            first = false
            val child = bounds(ins, w, comp)
            val h = measure(comp, child.width)
            comp.setBounds(child.left, y, child.width, h)
            y += h
        }
    }

    private fun measure(comp: Component, width: Int): Int {
        val hit = cache[comp]
        if (comp.isValid && hit?.width == width) return hit.height
        // Pre-size to available width so HTML panes reflow before we measure.
        comp.setSize(width, comp.height.coerceAtLeast(1))
        val h = comp.preferredSize.height
        cache[comp] = Measured(width, h)
        return h
    }

    private fun bounds(ins: Insets, width: Int, comp: Component): Bounds {
        val view = view(comp) ?: return Bounds(ins.left, width)
        if (view.sessionViewKind != SessionView.Kind.UserPrompt) return Bounds(ins.left, width)
        val shift = JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_INDENT)
        val next = width - shift
        if (next < JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_INDENT)) return Bounds(ins.left, width)
        return Bounds(ins.left + shift, next)
    }

    private fun insets(parent: Container): Insets {
        val base = parent.insets
        return Insets(
            base.top + JBUI.scale(basePad.top),
            base.left + JBUI.scale(basePad.left),
            base.bottom + JBUI.scale(basePad.bottom),
            base.right + JBUI.scale(basePad.right),
        )
    }

    private fun gap(comp: Component): Int {
        if (view(comp)?.sessionGapKind == SessionView.Kind.UserPrompt) return JBUI.scale(SessionUiStyle.SessionLayout.USER_PROMPT_GAP)
        return JBUI.scale(baseGap)
    }

    private fun view(comp: Component): SessionView? = comp as? SessionView

    private data class Bounds(val left: Int, val width: Int)

    private data class Measured(val width: Int, val height: Int)
}

/**
 * A panel pre-configured with [SessionLayout] and the [Scrollable] interface.
 *
 * Setting `getScrollableTracksViewportWidth = true` tells the enclosing
 * [JScrollPane] to force the panel's width to match the viewport, giving
 * [SessionLayout] a valid width to measure against.
 */
open class SessionLayoutPanel(
    gap: Int = SessionUiStyle.SessionLayout.GAP,
    pad: Insets = JBUI.emptyInsets(),
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
    ): Int = JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT)
    override fun getScrollableBlockIncrement(
        visibleRect: java.awt.Rectangle,
        @Suppress("UNUSED_PARAMETER") orientation: Int,
        @Suppress("UNUSED_PARAMETER") direction: Int,
    ): Int = visibleRect.height
}
