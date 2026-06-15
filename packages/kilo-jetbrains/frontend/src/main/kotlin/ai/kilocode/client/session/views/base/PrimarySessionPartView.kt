package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import javax.swing.JComponent

abstract class PrimarySessionPartView(
    header: JComponent,
    content: JComponent,
    expanded: Boolean = false,
    expandable: Boolean = true,
) : AbstractSessionPartView(header, content, expanded, expandable) {
    init {
        isOpaque = true
        background = SessionUiStyle.View.Surface.bgColor()
        row.isOpaque = true
        row.background = SessionUiStyle.View.Surface.headerBgColor()
        row.border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
        )
        syncBorder()
    }

    override fun expand(): Boolean {
        val changed = super.expand()
        if (changed) syncBorder()
        return changed
    }

    override fun collapse(): Boolean {
        val changed = super.collapse()
        if (changed) syncBorder()
        return changed
    }

    override fun hoverColor(value: Boolean) =
        if (value) SessionUiStyle.View.Surface.headerHoverBgColor() else SessionUiStyle.View.Surface.headerBgColor()

    private fun syncBorder() {
        if (isExpanded()) {
            border = JBUI.Borders.customLine(SessionUiStyle.View.Outline.color(), SessionUiStyle.View.Outline.width())
            return
        }
        border = JBUI.Borders.empty(1)
    }
}
