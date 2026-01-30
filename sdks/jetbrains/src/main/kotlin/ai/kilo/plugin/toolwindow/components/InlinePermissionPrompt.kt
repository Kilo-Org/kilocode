package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.PermissionRequest
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import com.intellij.icons.AllIcons
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JPanel

/**
 * Compact inline permission prompt displayed below tool cards.
 * Matches the web client UX with right-aligned action buttons.
 * Uses warning colors to indicate permission request.
 */
class InlinePermissionPrompt(
    private val request: PermissionRequest,
    private val onReply: (reply: String) -> Unit
) : JPanel(FlowLayout(FlowLayout.RIGHT, KiloSpacing.md, 0)) {

    init {
        isOpaque = true
        background = KiloTheme.surfaceWarningWeak
        border = BorderFactory.createCompoundBorder(
            JBUI.Borders.customLine(KiloTheme.borderWarning, 1, 0, 0, 0),
            JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        )

        // Deny button (ghost style)
        val denyButton = JButton("Deny").apply {
            icon = AllIcons.Actions.Cancel
            isContentAreaFilled = false
            isBorderPainted = false
            foreground = KiloTheme.textWeak
            addActionListener { onReply("reject") }
        }
        add(denyButton)

        // Allow Always button (secondary style) - only if patterns available
        if (request.always.isNotEmpty()) {
            val allowAlwaysButton = JButton("Allow Always").apply {
                icon = AllIcons.Actions.CheckMulticaret
                toolTipText = "Allow for: ${request.always.joinToString(", ")}"
                background = KiloTheme.buttonSecondaryBg
                foreground = KiloTheme.buttonSecondaryFg
                addActionListener { onReply("always") }
            }
            add(allowAlwaysButton)
        }

        // Allow Once button (primary style)
        val allowOnceButton = JButton("Allow Once").apply {
            icon = AllIcons.Actions.Checked
            background = KiloTheme.buttonPrimaryBg
            foreground = KiloTheme.buttonPrimaryFg
            addActionListener { onReply("once") }
        }
        add(allowOnceButton)
    }
}
