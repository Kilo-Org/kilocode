package ai.kilo.plugin.ui.components.chat.message.parts

import ai.kilo.plugin.model.PermissionRequest
import ai.kilo.plugin.ui.KiloSpacing
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import javax.swing.JButton
import javax.swing.JPanel

/**
 * Simple permission prompt with 3 standard buttons.
 */
class InlinePermissionPrompt(
    private val request: PermissionRequest,
    private val onReply: (reply: String) -> Unit
) : JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.sm, 0)) {

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.xs, 0)

        // Deny button
        add(JButton("Deny").apply {
            addActionListener { onReply("reject") }
        })

        // Allow Always button - only if patterns available
        if (request.always.isNotEmpty()) {
            add(JButton("Allow Always").apply {
                toolTipText = "Allow for: ${request.always.joinToString(", ")}"
                addActionListener { onReply("always") }
            })
        }

        // Allow Once button
        add(JButton("Allow Once").apply {
            addActionListener { onReply("once") }
        })
    }
}
