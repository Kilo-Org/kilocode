package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable

internal open class SettingsPanel : SettingsOverlayPanel() {
    val top = SettingsTop()
    val settings = Stack.vertical()

    init {
        val body = SettingsBody()
            .next(top)
            .gap(UiStyle.Gap.lg())
            .next(settings)
        content.add(JBScrollPane(body).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        }, BorderLayout.CENTER)
    }

    fun setContent(component: JComponent) {
        settings.removeAll()
        settings.next(component)
        revalidate()
        repaint()
    }

    protected fun setCenter(component: JComponent) {
        val layout = content.layout as? BorderLayout
        layout?.getLayoutComponent(BorderLayout.CENTER)?.let { content.remove(it) }
        content.add(component, BorderLayout.CENTER)
        revalidate()
        repaint()
    }

}

private class SettingsBody : Stack(StackAxis.VERTICAL), Scrollable {
    override fun getScrollableTracksViewportWidth() = true
    override fun getScrollableTracksViewportHeight() = false
    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize
    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = UiStyle.Gap.pad()
    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = visibleRect.height
}
