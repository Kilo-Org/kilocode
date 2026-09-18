package ai.kilocode.client.ui

import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.GraphicsEnvironment
import java.awt.MouseInfo
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JLayeredPane
import javax.swing.JPanel
import javax.swing.SwingUtilities

open class LayeredOverlayPanel(
    content: JPanel = BorderLayoutPanel(),
    overlay: Overlay = Overlay(),
    blocker: Blocker = Blocker(),
) : JLayeredPane() {

    private val baseContent = content

    private val baseOverlay = overlay

    private val baseBlocker = blocker

    open val content: JPanel get() = baseContent

    open val overlay: Overlay get() = baseOverlay

    open val blocker: Blocker get() = baseBlocker

    // An overlay that starts covering the pointer takes the hover over from the content below it.
    // Swing already stops delivering mouse events to a covered component, but it sends no exit when
    // the cover appears or moves without the pointer moving, so the content would keep its hover —
    // and any hover-driven popup — alive behind the overlay.
    private val cover = object : ComponentAdapter() {
        override fun componentShown(e: ComponentEvent) = takeOverHover()
        override fun componentHidden(e: ComponentEvent) = takeOverHover()
        override fun componentMoved(e: ComponentEvent) = takeOverHover()
        override fun componentResized(e: ComponentEvent) = takeOverHover()
    }

    init {
        layout = null
        add(baseContent)
        setLayer(baseContent, DEFAULT_LAYER)
        add(baseOverlay)
        setLayer(baseOverlay, PALETTE_LAYER)
        add(baseBlocker)
        setLayer(baseBlocker, MODAL_LAYER)
        baseBlocker.isVisible = false
        baseOverlay.cover = cover
        baseBlocker.addComponentListener(cover)
    }

    /**
     * Adds a floating child above the content. A child that [blocks] owns the pointer where it sits:
     * it takes the hover over from the content beneath it, which a decoration painted for the content
     * below (a hover affordance of the very row it sits on) must not do.
     */
    fun addOverlay(child: JComponent, blocks: Boolean = false, bounds: (JPanel, JComponent) -> Rectangle) {
        overlay.addOverlay(child, blocks, bounds)
    }

    @RequiresEdt
    fun setModalContent(child: JComponent?, maxW: (() -> Int)? = null) {
        blocker.removeAll()
        // Keep the standard large dialog padding on every side so modal content never sits flush
        // against the blocker edges.
        blocker.border = if (child == null) null else JBUI.Borders.empty(UiStyle.Gap.pad())
        if (child != null) blocker.add(child.align(HAlign.CENTER, VAlign.CENTER, maxW = maxW), BorderLayout.CENTER)
        blocker.isVisible = child != null
        if (child != null) blocker.requestFocusInWindow()
        invalidate()
        blocker.invalidate()
        child?.invalidate()
        if (width > 0 && height > 0) {
            doLayout()
            child?.let(::layoutTree)
        }
        blocker.revalidate()
        blocker.repaint()
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun setBlocked(value: Boolean) {
        blocker.isVisible = value
        if (value) blocker.requestFocusInWindow()
        invalidate()
        blocker.invalidate()
        if (width > 0 && height > 0) doLayout()
        revalidate()
        repaint()
    }

    override fun doLayout() {
        components
            .sortedBy { getLayer(it) }
            .forEach { child ->
                child.setBounds(0, 0, width, height)
                child.doLayout()
            }
    }

    /**
     * Hands the hover of the content under the pointer over to the overlay that now covers it.
     * Deferred because the trigger can arrive mid-layout, while a hover handler is free to close a
     * popup or re-lay out the card it belongs to.
     */
    private fun takeOverHover() = SwingUtilities.invokeLater(::releaseHover)

    @RequiresEdt
    private fun releaseHover() {
        if (GraphicsEnvironment.isHeadless() || !isShowing) return
        val point = MouseInfo.getPointerInfo()?.location ?: return
        SwingUtilities.convertPointFromScreen(point, this)
        releaseHover(point)
    }

    /** Releases the hover of the content at [point], in this panel's coordinates, when covered. */
    @RequiresEdt
    internal fun releaseHover(point: Point) {
        if (!covered(point)) return
        val local = SwingUtilities.convertPoint(this, point, content)
        val below = SwingUtilities.getDeepestComponentAt(content, local.x, local.y) ?: return
        val spot = SwingUtilities.convertPoint(this, point, below)
        below.dispatchEvent(
            MouseEvent(below, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, spot.x, spot.y, 0, false),
        )
    }

    /** Whether the blocker or a blocking overlay child sits above the content at [point]. */
    private fun covered(point: Point): Boolean {
        if (!Rectangle(size).contains(point)) return false
        if (blocker.isVisible) return true
        val local = SwingUtilities.convertPoint(this, point, overlay)
        return overlay.blocks(local.x, local.y)
    }

    override fun getPreferredSize(): Dimension {
        val w = listOf(content, overlay).maxOfOrNull { it.preferredSize.width } ?: 0
        val h = listOf(content, overlay).maxOfOrNull { it.preferredSize.height } ?: 0
        return Dimension(w, h)
    }

    open class Overlay : BorderLayoutPanel() {

        private val items = linkedMapOf<JComponent, (JPanel, JComponent) -> Rectangle>()

        private val blocking = linkedSetOf<JComponent>()

        /** Notified when a blocking child is shown, hidden, moved, or resized. */
        internal var cover: ComponentAdapter? = null

        init {
            layout = null
            isOpaque = false
        }

        fun addOverlay(child: JComponent, blocks: Boolean = false, bounds: (JPanel, JComponent) -> Rectangle) {
            items[child] = bounds
            if (blocks) {
                blocking.add(child)
                cover?.let(child::addComponentListener)
            }
            add(child)
        }

        override fun contains(x: Int, y: Int): Boolean = components.any { hits(it, x, y) }

        /** Whether a child that blocks the content beneath it covers ([x], [y]). */
        internal fun blocks(x: Int, y: Int): Boolean = blocking.any { hits(it, x, y) }

        private fun hits(child: Component, x: Int, y: Int): Boolean =
            child.isVisible && child.bounds.contains(x, y) && child.contains(x - child.x, y - child.y)

        override fun doLayout() {
            items.forEach { (child, bounds) ->
                child.bounds = bounds(this, child)
                child.doLayout()
            }
        }

        override fun getPreferredSize(): Dimension {
            val pref = super.getPreferredSize()
            val w = maxOf(pref.width, components.maxOfOrNull { it.preferredSize.width } ?: 0)
            val h = maxOf(pref.height, components.maxOfOrNull { it.preferredSize.height } ?: 0)
            return Dimension(w, h)
        }
    }

    open class Blocker : JPanel() {
        init {
            layout = BorderLayout()
            isFocusable = true
        }

        override fun updateUI() {
            super.updateUI()
            background = UiStyle.Colors.bg()
            isOpaque = true
        }

        override fun contains(x: Int, y: Int): Boolean {
            if (!isVisible) return false
            return super.contains(x, y)
        }

        override fun doLayout() {
            super.doLayout()
            components.forEach { layoutTree(it) }
        }
    }
}

private fun layoutTree(comp: java.awt.Component) {
    comp.doLayout()
    if (comp is Container) comp.components.forEach { layoutTree(it) }
}
