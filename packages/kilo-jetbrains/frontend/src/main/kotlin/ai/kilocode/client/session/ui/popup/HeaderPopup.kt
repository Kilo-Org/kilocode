package ai.kilocode.client.session.ui.popup

import com.intellij.openapi.Disposable
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Container
import java.awt.Dimension
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JPanel

class HeaderPopupRequest(
    val anchor: JComponent,
    val build: () -> HeaderPopupBody,
    val shown: () -> Unit = {},
)

class HeaderPopupBody(
    component: JComponent,
    val disposable: Disposable,
    val background: Color,
) {
    val component: JComponent = HeaderPopupPanel(component)
}

private class HeaderPopupPanel(private val child: JComponent) : JPanel(BorderLayout()) {
    init {
        // Transparent so the balloon fill shows uniformly behind nested popup content.
        isOpaque = false
        add(child, BorderLayout.CENTER)
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        val cap = JBUI.scale(350)
        val width = size.width.takeIf { it > 0 }?.coerceAtMost(cap) ?: cap
        fit(child, width)
        val height = super.getPreferredSize().height.coerceAtMost(JBUI.scale(450))
        return Dimension(width, height)
    }

    private fun fit(item: JComponent, width: Int) {
        if (width <= 0) return
        // JBHtmlPane derives wrapped preferred height from the current width, not just HTML content.
        item.setSize(width, Short.MAX_VALUE.toInt())
        layout(item, width)
        reset(item)
    }

    private fun layout(item: Container, width: Int) {
        if (item is JEditorPane) {
            item.preferredSize = null
            item.setSize(width, Short.MAX_VALUE.toInt())
            item.preferredSize = Dimension(width, item.preferredSize.height)
            item.size = item.preferredSize
            return
        }
        item.doLayout()
        val insets = item.insets
        val inner = (width - insets.left - insets.right).coerceAtLeast(0)
        for (child in item.components) {
            val nested = child as? Container ?: continue
            val next = child.width.takeIf { it > 0 }?.coerceAtMost(inner) ?: inner
            layout(nested, next)
        }
    }

    private fun reset(item: Container) {
        item.invalidate()
        for (child in item.components) {
            val nested = child as? Container ?: continue
            reset(nested)
        }
    }
}
