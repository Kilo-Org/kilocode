package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Container
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent

data class ActiveListEditOptions(
    val value: String,
    val label: String? = null,
    val button: String = KiloBundle.message("common.rename"),
)

internal fun activeListEditContent(
    opts: ActiveListEditOptions,
    hide: () -> Unit,
    commit: (String) -> Unit,
): JComponent {
    val field = JBTextField(opts.value, 24)
    val action = object : AbstractAction(opts.button) {
        override fun actionPerformed(e: ActionEvent) {
            val text = field.text.trim()
            if (!enabled(text, opts.value)) return
            hide()
            commit(text)
        }
    }.apply { putValue(DialogWrapper.DEFAULT_ACTION, true) }
    val button = DialogWrapper.createJButtonForAction(action, null)

    fun sync() {
        action.isEnabled = enabled(field.text, opts.value)
    }

    field.document.addDocumentListener(object : DocumentAdapter() {
        override fun textChanged(e: DocumentEvent) = sync()
    })

    val content = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        opts.label?.takeIf { it.isNotBlank() }?.let { text ->
            next(JBLabel(text).apply {
                foreground = UIUtil.getContextHelpForeground()
            })
        }
        next(field)
        next(BorderLayoutPanel().andTransparent().addToRight(button))
    }

    sync()
    return content
}

internal fun showActiveListEditPopup(
    anchor: RelativePoint,
    opts: ActiveListEditOptions,
    commit: (String) -> Unit,
): Balloon {
    lateinit var balloon: Balloon
    val content = activeListEditContent(opts, hide = { balloon.hide(true) }, commit)
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
    SwingUtilities.getRootPane(content)?.defaultButton = activeListEditButton(content)
    activeListEditField(content)?.let { field ->
        SwingUtilities.invokeLater {
            field.requestFocusInWindow()
            field.selectAll()
        }
    }
    return balloon
}

private fun enabled(text: String, value: String): Boolean {
    val next = text.trim()
    return next.isNotBlank() && next != value.trim()
}

private fun activeListEditButton(root: Container): JButton? {
    for (child in root.components) {
        if (child is JButton) return child
        if (child is Container) activeListEditButton(child)?.let { return it }
    }
    return null
}

private fun activeListEditField(root: Container): JBTextField? {
    for (child in root.components) {
        if (child is JBTextField) return child
        if (child is Container) activeListEditField(child)?.let { return it }
    }
    return null
}
