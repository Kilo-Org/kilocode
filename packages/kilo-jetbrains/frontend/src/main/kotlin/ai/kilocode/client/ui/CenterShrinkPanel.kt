package ai.kilocode.client.ui

import java.awt.Component
import java.awt.Dimension
import javax.swing.JPanel

/**
 * Centers its single child and shrinks it to available space when needed.
 * If available space is larger than the child's maximum size, the child is not expanded.
 */
class CenterShrinkPanel(child: Component) : JPanel(null) {
    init {
        isOpaque = false
        add(child)
    }

    override fun doLayout() {
        if (componentCount == 0) return
        val child = getComponent(0)
        val insets = getInsets()
        val availW = width - insets.left - insets.right
        val availH = height - insets.top - insets.bottom
        val pref = child.preferredSize
        val max = child.maximumSize
        val w = minOf(pref.width, max.width, availW)
        val h = minOf(pref.height, max.height, availH)
        val x = insets.left + (availW - w) / 2
        val y = insets.top + (availH - h) / 2
        child.setBounds(x, y, w, h)
    }

    override fun getPreferredSize(): Dimension {
        if (componentCount == 0) return super.getPreferredSize()
        val pref = getComponent(0).preferredSize
        val insets = getInsets()
        return Dimension(pref.width + insets.left + insets.right, pref.height + insets.top + insets.bottom)
    }
}
