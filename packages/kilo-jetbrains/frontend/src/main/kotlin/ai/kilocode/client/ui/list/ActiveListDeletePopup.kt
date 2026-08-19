package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import javax.swing.JComponent

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
    return activeListDeletePopup(opts, hide, confirm).component
}

internal fun showActiveListDeletePopup(
    anchor: RelativePoint,
    opts: ActiveListDeleteOptions,
    confirm: (Boolean) -> Unit,
): Balloon {
    lateinit var balloon: Balloon
    val popup = activeListDeletePopup(opts, hide = { balloon.hide(true) }, confirm)
    balloon = showActiveListPopup(anchor, popup)
    return balloon
}

private fun activeListDeletePopup(
    opts: ActiveListDeleteOptions,
    hide: () -> Unit,
    confirm: (Boolean) -> Unit,
): ActiveListPopup {
    val gate = opts.gate?.let {
        JBCheckBox(it).apply { isOpaque = false }
    }
    val body = Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()).apply {
        next(JBLabel(opts.message))
        opts.detail?.takeIf { it.isNotBlank() }?.let { text ->
            next(JBLabel(text).apply {
                foreground = UIUtil.getContextHelpForeground()
            })
        }
        gate?.let { next(it) }
    }
    val popup = activeListPopup(
        body = body,
        button = opts.button,
        enabled = { gate?.isSelected ?: true },
        hide = hide,
        perform = { confirm(gate?.isSelected == true) },
    )
    gate?.addActionListener { popup.sync() }
    return popup
}
