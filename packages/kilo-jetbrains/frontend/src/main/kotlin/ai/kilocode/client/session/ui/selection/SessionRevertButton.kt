package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.HoverIcon
import com.intellij.icons.AllIcons
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Cursor

internal class SessionRevertButton(
    private val revert: () -> Unit,
) {
    val button = HoverIcon().apply {
        icon = AllIcons.Actions.Rollback
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("session.revert.hover")
        accessibleContext.accessibleName = KiloBundle.message("session.revert.hover")
    }

    init {
        button.addActionListener { revert() }
    }

    @RequiresEdt
    fun enabled(value: Boolean) {
        button.isEnabled = value
        button.toolTipText = if (value) {
            KiloBundle.message("session.revert.hover")
        } else {
            KiloBundle.message("session.revert.disabled.busy")
        }
    }
}
