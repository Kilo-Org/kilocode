package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Container
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingUtilities

data class ActiveListDeleteOptions(
    val message: String,
    val detail: String? = null,
    val gate: String? = null,
    val button: String = KiloBundle.message("common.delete"),
)

internal fun activeListDeleteContent(
    opts: ActiveListDeleteOptions,
    hide: () -> Unit,
    confirm: (Boolean) -> Unit,
): JComponent {
    val gate = opts.gate?.let {
        JBCheckBox(it).apply { isOpaque = false }
    }
    val action = object : AbstractAction(opts.button) {
        override fun actionPerformed(e: ActionEvent) {
            hide()
            confirm(gate?.isSelected == true)
        }
    }.apply { putValue(DialogWrapper.DEFAULT_ACTION, true) }
    val delete = DialogWrapper.createJButtonForAction(action, null).apply { isOpaque = false }

    fun sync() {
        action.isEnabled = gate?.isSelected ?: true
    }

    val content = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        next(JBLabel(opts.message))
        opts.detail?.takeIf { it.isNotBlank() }?.let { text ->
            next(JBLabel(text).apply {
                foreground = UIUtil.getContextHelpForeground()
            })
        }
        gate?.let { next(it) }
        next(BorderLayoutPanel().andTransparent().addToRight(delete))
    }

    gate?.addActionListener { sync() }
    sync()
    return content
}

internal fun showActiveListDeletePopup(
    anchor: RelativePoint,
    opts: ActiveListDeleteOptions,
    confirm: (Boolean) -> Unit,
): Balloon {
    lateinit var balloon: Balloon
    val content = activeListDeleteContent(opts, hide = { balloon.hide(true) }, confirm)
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
    SwingUtilities.getRootPane(content)?.defaultButton = activeListDeleteButton(content)
    return balloon
}

private fun activeListDeleteButton(root: Container): JButton? {
    for (child in root.components) {
        if (child is JButton) return child
        if (child is Container) activeListDeleteButton(child)?.let { return it }
    }
    return null
}
