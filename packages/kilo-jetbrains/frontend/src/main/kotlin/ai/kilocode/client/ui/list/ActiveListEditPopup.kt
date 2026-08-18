package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.JComponent
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent

data class ActiveListEditOptions(
    val value: String,
    val label: String? = KiloBundle.message("common.rename.help"),
    val button: String = KiloBundle.message("common.rename"),
)

internal fun activeListEditContent(
    opts: ActiveListEditOptions,
    hide: () -> Unit,
    commit: (String) -> Unit,
): JComponent {
    return activeListEditPopup(opts, hide, commit).component
}

internal fun showActiveListEditPopup(
    anchor: RelativePoint,
    opts: ActiveListEditOptions,
    commit: (String) -> Unit,
): Balloon {
    lateinit var balloon: Balloon
    val popup = activeListEditPopup(opts, hide = { balloon.hide(true) }, commit)
    balloon = showActiveListPopup(anchor, popup)
    activeListEditField(popup.component)?.let { field ->
        SwingUtilities.invokeLater {
            field.requestFocusInWindow()
            field.selectAll()
        }
    }
    return balloon
}

private fun activeListEditPopup(
    opts: ActiveListEditOptions,
    hide: () -> Unit,
    commit: (String) -> Unit,
): ActiveListPopup {
    val field = JBTextField(opts.value, 24)
    val body = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        opts.label?.takeIf { it.isNotBlank() }?.let { text ->
            next(JBLabel(text).apply {
                foreground = UIUtil.getContextHelpForeground()
            })
        }
        next(field)
    }
    val popup = activeListPopup(
        body = body,
        button = opts.button,
        enabled = { enabled(field.text, opts.value) },
        hide = hide,
        perform = { commit(field.text.trim()) },
    )
    field.document.addDocumentListener(object : DocumentAdapter() {
        override fun textChanged(e: DocumentEvent) = popup.sync()
    })
    return popup
}

private fun enabled(text: String, value: String): Boolean {
    val next = text.trim()
    return next.isNotBlank() && next != value.trim()
}

private fun activeListEditField(root: Container): JBTextField? {
    for (child in root.components) {
        if (child is JBTextField) return child
        if (child is Container) activeListEditField(child)?.let { return it }
    }
    return null
}
