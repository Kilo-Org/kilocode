package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingUtilities

internal class ActiveListPopup(
    val component: JComponent,
    val button: JButton,
    private val action: AbstractAction,
    private val enabled: () -> Boolean,
) {
    fun sync() {
        action.isEnabled = enabled()
    }
}

internal fun activeListPopup(
    body: JComponent,
    button: String,
    enabled: () -> Boolean = { true },
    hide: () -> Unit,
    perform: () -> Unit,
): ActiveListPopup {
    val action = object : AbstractAction(button) {
        override fun actionPerformed(e: ActionEvent) {
            if (!enabled()) return
            hide()
            perform()
        }
    }.apply { putValue(DialogWrapper.DEFAULT_ACTION, true) }
    val control = DialogWrapper.createJButtonForAction(action, null).apply { isOpaque = false }
    val root = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        next(body)
        next(BorderLayoutPanel().andTransparent().addToRight(control))
    }
    val popup = ActiveListPopup(root, control, action, enabled)
    popup.sync()
    return popup
}

internal fun showActiveListPopup(anchor: RelativePoint, popup: ActiveListPopup): Balloon {
    val balloon = JBPopupFactory.getInstance()
        .createBalloonBuilder(popup.component)
        .setFillColor(UIUtil.getToolTipBackground())
        .setBorderColor(JBUI.CurrentTheme.Tooltip.borderColor())
        .setCloseButtonEnabled(true)
        .setHideOnCloseClick(true)
        .setHideOnClickOutside(true)
        .setHideOnKeyOutside(true)
        .setHideOnAction(false)
        .setShowCallout(true)
        .setAnimationCycle(0)
        .setRequestFocus(true)
        .createBalloon()
    balloon.show(anchor, Balloon.Position.below)
    SwingUtilities.getRootPane(popup.component)?.defaultButton = popup.button
    return balloon
}
