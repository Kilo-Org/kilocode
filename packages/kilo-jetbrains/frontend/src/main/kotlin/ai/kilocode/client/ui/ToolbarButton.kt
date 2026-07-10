package ai.kilocode.client.ui

import java.awt.Cursor
import javax.swing.Icon

internal data class ToolbarButtonAction(
    val icon: Icon,
    val text: String,
    val handler: () -> Unit,
)

internal fun toolbarButton(action: ToolbarButtonAction, fill: Boolean = false) = HoverIcon(fill = fill).apply {
    icon = action.icon
    cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    toolTipText = action.text
    accessibleContext.accessibleName = action.text
    addActionListener { action.handler() }
}
