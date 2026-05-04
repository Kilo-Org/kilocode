package ai.kilocode.client.session.ui

import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JLayeredPane
import javax.swing.JPanel

class SessionRootPanel : JLayeredPane() {

    val content = JPanel(BorderLayout())

    val overlay = Overlay()

    init {
        layout = null
        add(content)
        setLayer(content, DEFAULT_LAYER)
        add(overlay)
        setLayer(overlay, PALETTE_LAYER)
    }

    fun addOverlay(child: JComponent, bounds: (JPanel, JComponent) -> Rectangle) {
        overlay.addOverlay(child, bounds)
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
        val w = components.maxOfOrNull { it.preferredSize.width } ?: 0
        val h = components.maxOfOrNull { it.preferredSize.height } ?: 0
        return Dimension(w, h)
    }

    class Overlay : JPanel(null) {

        private val items = linkedMapOf<JComponent, (JPanel, JComponent) -> Rectangle>()

        init {
            isOpaque = false
        }

        fun addOverlay(child: JComponent, bounds: (JPanel, JComponent) -> Rectangle) {
            items[child] = bounds
            add(child)
        }

        override fun contains(x: Int, y: Int): Boolean {
            for (child in components) {
                if (child.isVisible && child.bounds.contains(x, y)) return true
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
            return Dimension(w, h)
        }
    }
}
