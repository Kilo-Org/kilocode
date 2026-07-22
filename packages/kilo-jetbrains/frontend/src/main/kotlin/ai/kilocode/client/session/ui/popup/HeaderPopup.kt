package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.Disposable
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Insets
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JPanel
import javax.swing.JScrollPane

class HeaderPopupRequest(
    val anchor: JComponent,
    val build: () -> HeaderPopupBody,
    val shown: () -> Unit = {},
)

class HeaderPopupBody(
    component: JComponent,
    val disposable: Disposable,
    val background: Color,
    maxWidth: Int = SessionUiStyle.View.Popup.MAX_WIDTH,
) {
    val component: JComponent = HeaderPopupPanel(component, JBUI.scale(maxWidth))
}

private class HeaderPopupPanel(
    private val child: JComponent,
    private val maxWidth: Int,
) : JPanel(BorderLayout()) {
    init {
        // Transparent so the balloon fill shows uniformly behind nested popup content.
        isOpaque = false
        add(child, BorderLayout.CENTER)
    }

    override fun getPreferredSize(): Dimension {
        val width = contentWidth(child).takeIf { it > 0 }?.coerceAtMost(maxWidth) ?: maxWidth
        fit(child, width)
        val height = super.getPreferredSize().height.coerceAtMost(JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT))
        return Dimension(width, height)
    }

    private fun contentWidth(item: Component): Int = when (item) {
        is EditorTextField -> item.preferredSize.width
        is JBTextArea -> item.preferredSize.width
        is JEditorPane -> item.preferredSize.width
        is JScrollPane -> {
            val view = item.viewport?.view?.let(::contentWidth) ?: 0
            view + horiz(item.insets) + horiz(item.viewportBorder?.getBorderInsets(item))
        }
        is Container -> (item.components.maxOfOrNull(::contentWidth) ?: 0) + horiz((item as? JComponent)?.insets)
        is JComponent -> item.preferredSize.width
        else -> 0
    }

    private fun horiz(insets: Insets?): Int = (insets?.left ?: 0) + (insets?.right ?: 0)

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
