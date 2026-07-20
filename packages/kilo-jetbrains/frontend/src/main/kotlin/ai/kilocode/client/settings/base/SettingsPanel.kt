package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable

// The platform no longer wraps our configurables in its default margin (they are Configurable.NoMargin),
// so the page owns its own insets here. The scroll pane stays flush to the panel edges — its scrollbar
// touches the right edge — while the content border and body inset keep text and controls padded.
internal open class SettingsPanel(scroll: Boolean = true, pad: Boolean = true) : SettingsOverlayPanel() {
    val top = SettingsTop()
    val settings = Stack.vertical()

    init {
        val body = SettingsBody()
            .next(top)
            .gap(UiStyle.Gap.lg())
            .next(settings)
        if (pad && scroll) body.border = JBUI.Borders.emptyRight(UiStyle.Gap.xl())
        if (scroll) {
            content.add(JBScrollPane(body).apply {
                border = null
                horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            }, BorderLayout.CENTER)
        } else {
            content.add(body, BorderLayout.CENTER)
        }
        if (pad) {
            content.border = JBUI.Borders.empty(
                UiStyle.Gap.pad(),
                UiStyle.Gap.xl(),
                UiStyle.Gap.xl(),
                if (scroll) 0 else UiStyle.Gap.xl(),
            )
        }
    }

    fun setContent(component: JComponent) {
        settings.removeAll()
        settings.next(component)
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
