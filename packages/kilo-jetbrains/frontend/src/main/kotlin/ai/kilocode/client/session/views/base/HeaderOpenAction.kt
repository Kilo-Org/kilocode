package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.selection.hoverPlaceholder
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.toolbarButton
import javax.swing.Icon
import javax.swing.JComponent

/**
 * Trailing header "open in editor" affordance shared by the edit/patch, modified-files, and task
 * cards. [button] is a hover toolbar button that [ai.kilocode.client.session.ui.selection.SessionHoverCopyOverlay]
 * floats over the zero-height [anchor]; the anchor only reserves the button's width in the header
 * row so header content never sits under it. Views expose [button] as `SessionCopyTarget.copyToolbar`
 * and [anchor] as `copyAnchor`, giving every card an identical open action instead of a bespoke icon.
 */
internal class HeaderOpenAction(icon: Icon, tooltip: String, handler: () -> Unit) {
    val button = toolbarButton(ToolbarButtonAction(icon, tooltip, handler))
    val anchor: JComponent = hoverPlaceholder(button)

    var enabled: Boolean
        get() = button.isEnabled
        set(value) {
            button.isEnabled = value
        }
}
