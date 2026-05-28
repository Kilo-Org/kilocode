package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import javax.swing.JComponent

abstract class SecondarySessionPartView(
    header: JComponent,
    content: JComponent,
    expanded: Boolean = false,
    expandable: Boolean = true,
) : AbstractSessionPartView(header, content, expanded, expandable) {
    init {
        row.isOpaque = true
        row.background = SessionUiStyle.View.header()
        row.border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
        )
    }

    override fun hoverColor(value: Boolean) = if (value) SessionUiStyle.View.headerHover() else SessionUiStyle.View.header()
}
