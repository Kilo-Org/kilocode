package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import javax.swing.JComponent

abstract class SecondarySessionPartView(
    header: JComponent,
    content: () -> JComponent,
    expanded: Boolean = false,
    expandable: Boolean = true,
) : AbstractSessionPartView(header, content, expanded, expandable) {

    constructor(
        header: JComponent,
        content: JComponent,
        expanded: Boolean = false,
        expandable: Boolean = true,
    ) : this(header, { content }, expanded, expandable)
    init {
        row.border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            SessionUiStyle.View.Header.left(),
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            SessionUiStyle.View.Header.right(),
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

    // A collapsed card is a standalone block, so its hover fill is rounded; an expanded card sits
    // inside the rectangular outline, so its header hover stays square to meet that edge.
    override fun hoverArc() = if (isExpanded()) 0 else JBUI.scale(SessionUiStyle.View.BLOCK_ARC)

    private fun syncBorder() {
        if (isExpanded()) {
            border = JBUI.Borders.customLine(SessionUiStyle.View.Outline.color(), SessionUiStyle.View.Outline.width())
            return
        }
        border = JBUI.Borders.empty(1)
    }
}
