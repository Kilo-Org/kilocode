package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.LayeredOverlayPanel
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

internal open class SettingsPanel : LayeredOverlayPanel() {
    val top = SettingsTop()
    val settings = Stack.vertical()
    val progress = SettingsProgressOverlay()

    init {
        val body = SettingsBody()
            .next(top)
            .gap(UiStyle.Gap.lg())
            .next(settings)
        content.add(JBScrollPane(body).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        }, BorderLayout.CENTER)
        addOverlay(progress) { pane, child ->
            val size = child.preferredSize
            Rectangle(
                ((pane.width - size.width) / 2).coerceAtLeast(0),
                UiStyle.Gap.pad(),
                size.width,
                size.height,
            )
        }
    }

    fun setContent(component: JComponent) {
        settings.removeAll()
        settings.next(component)
        revalidate()
        repaint()
    }

    fun showProgress(text: String) {
        progress.showProgress(text)
        overlay.revalidate()
        overlay.repaint()
    }

    fun showError(text: String) {
        progress.showError(text)
        overlay.revalidate()
        overlay.repaint()
    }

    fun clearProgress() {
        progress.clearProgress()
        overlay.revalidate()
        overlay.repaint()
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
