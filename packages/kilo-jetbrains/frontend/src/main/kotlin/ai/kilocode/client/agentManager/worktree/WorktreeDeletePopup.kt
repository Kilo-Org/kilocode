package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.SwingUtilities

internal fun showWorktreeDeletePopup(
    anchor: RelativePoint,
    item: WorktreeDto,
    onConfirm: (Boolean) -> Unit,
): Balloon {
    lateinit var balloon: Balloon
    val confirm = JBCheckBox(KiloBundle.message("worktree.delete.locked.confirm")).apply {
        isOpaque = false
    }
    val action = object : AbstractAction(KiloBundle.message("worktree.delete.button")) {
        override fun actionPerformed(e: ActionEvent) {
            balloon.hide(true)
            onConfirm(item.locked)
        }
    }.apply { putValue(DialogWrapper.DEFAULT_ACTION, true) }
    val delete = DialogWrapper.createJButtonForAction(action, null).apply { isOpaque = false }

    fun sync() {
        action.isEnabled = !item.locked || confirm.isSelected
    }

    val content = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        next(JBLabel(KiloBundle.message("worktree.delete.confirm.message", item.name)))
        next(JBLabel(KiloBundle.message("worktree.delete.confirm.detail")).apply {
            foreground = UIUtil.getContextHelpForeground()
        })
        if (item.locked) {
            next(confirm)
        }
        next(BorderLayoutPanel().andTransparent().addToRight(delete))
    }

    confirm.addActionListener { sync() }
    sync()

    balloon = JBPopupFactory.getInstance()
        .createBalloonBuilder(content)
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
    SwingUtilities.getRootPane(content)?.defaultButton = delete
    return balloon
}
