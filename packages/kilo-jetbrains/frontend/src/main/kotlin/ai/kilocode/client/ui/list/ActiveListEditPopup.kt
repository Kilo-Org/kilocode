package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.UIUtil
import java.awt.Container
import javax.swing.JComponent
import javax.swing.SwingUtilities

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
    // A greyed-out primary button reads as a broken popup, so the button stays live and a blank or
    // unchanged name just closes without a rename round trip.
    return activeListPopup(
        body = body,
        button = opts.button,
        hide = hide,
        perform = {
            val next = field.text.trim()
            if (next.isNotBlank() && next != opts.value.trim()) commit(next)
        },
    )
}

private fun activeListEditField(root: Container): JBTextField? {
    for (child in root.components) {
        if (child is JBTextField) return child
        if (child is Container) activeListEditField(child)?.let { return it }
    }
    return null
}
