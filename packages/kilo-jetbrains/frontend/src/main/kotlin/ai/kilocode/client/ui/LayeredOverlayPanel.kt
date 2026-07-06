package ai.kilocode.client.ui

import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Container
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JLayeredPane
import javax.swing.JPanel

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

    init {
        layout = null
        add(baseContent)
        setLayer(baseContent, DEFAULT_LAYER)
        add(baseOverlay)
        setLayer(baseOverlay, PALETTE_LAYER)
        add(baseBlocker)
        setLayer(baseBlocker, MODAL_LAYER)
        baseBlocker.isVisible = false
    }

    fun addOverlay(child: JComponent, bounds: (JPanel, JComponent) -> Rectangle) {
        overlay.addOverlay(child, bounds)
    }

    @RequiresEdt
    fun setModalContent(child: JComponent?) {
        blocker.removeAll()
        if (child != null) blocker.add(child.align(HAlign.CENTER, VAlign.CENTER), BorderLayout.CENTER)
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

    override fun getPreferredSize(): Dimension {
        val w = listOf(content, overlay).maxOfOrNull { it.preferredSize.width } ?: 0
        val h = listOf(content, overlay).maxOfOrNull { it.preferredSize.height } ?: 0
        return JBDimension(w, h)
    }

    open class Overlay : BorderLayoutPanel() {

        private val items = linkedMapOf<JComponent, (JPanel, JComponent) -> Rectangle>()

        init {
            layout = null
            isOpaque = false
        }

        fun addOverlay(child: JComponent, bounds: (JPanel, JComponent) -> Rectangle) {
            items[child] = bounds
            add(child)
        }

        override fun contains(x: Int, y: Int): Boolean {
            for (child in components) {
                if (child.isVisible && child.bounds.contains(x, y) && child.contains(x - child.x, y - child.y)) return true
            }
            return false
        }

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
            return JBDimension(w, h)
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
