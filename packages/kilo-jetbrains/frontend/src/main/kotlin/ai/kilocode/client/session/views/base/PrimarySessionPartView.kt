package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import java.awt.Color
import javax.swing.JComponent

abstract class PrimarySessionPartView(
    header: JComponent,
    content: JComponent,
    expanded: Boolean = false,
    expandable: Boolean = true,
) : AbstractSessionPartView(header, content, expanded, expandable) {
    init {
        isOpaque = true
        background = SessionUiStyle.View.surface()
        border = SessionUiStyle.View.sessionView()
        row.isOpaque = true
        row.background = SessionUiStyle.View.header()
        row.border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.SESSION_VIEW_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.SESSION_VIEW_HORIZONTAL_PADDING),
        )
    }

    override fun hoverColor(value: Boolean) = if (value) SessionUiStyle.View.headerHover() else SessionUiStyle.View.header()

    override fun applyHover(value: Boolean, color: Color) {
        border = if (value) SessionUiStyle.View.sessionView(SessionUiStyle.View.hoverLine()) else SessionUiStyle.View.sessionView()
        repaint()
    }
}
