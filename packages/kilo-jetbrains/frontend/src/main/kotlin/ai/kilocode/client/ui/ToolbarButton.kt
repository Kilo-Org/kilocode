package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
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

/**
 * A flat, hoverable icon+label button matching the toolbar hover treatment (no platform button
 * outline). Sizes to its content and shares [HoverIcon]'s rounded hover background.
 */
internal fun hoverTextButton(action: ToolbarButtonAction, tooltip: String? = null) = HoverIcon().apply {
    icon = action.icon
    text = action.text
    iconTextGap = UiStyle.Gap.sm()
    // Drop the platform button's wide default margin, then apply the platform's standard toolbar
    // button insets so the hover pill matches a regular toolbar action button.
    margin = JBUI.emptyInsets()
    border = JBUI.Borders.empty(JBUI.CurrentTheme.Toolbar.toolbarButtonInsets())
    cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    toolTipText = tooltip ?: action.text
    accessibleContext.accessibleName = action.text
    addActionListener { action.handler() }
}

/**
 * Icon-only sibling of [hoverTextButton]: same margin, insets, and overall height, so an icon-only
 * action sitting next to labelled ones shares their hover-pill metrics instead of falling back to
 * the smaller square [toolbarButton] size. The tooltip stands in for the missing label.
 */
internal fun hoverIconButton(action: ToolbarButtonAction) = HoverIcon().apply {
    match = true
    icon = action.icon
    margin = JBUI.emptyInsets()
    border = JBUI.Borders.empty(JBUI.CurrentTheme.Toolbar.toolbarButtonInsets())
    cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    toolTipText = action.text
    accessibleContext.accessibleName = action.text
    addActionListener { action.handler() }
}
