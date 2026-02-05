package ai.kilo.plugin.ui.components.chat.message.parts

import ai.kilo.plugin.model.PermissionRequest
import kotlinx.serialization.json.JsonPrimitive
import java.awt.BorderLayout
import javax.swing.*

/**
 * Permission prompt with single-line header and radio button options.
 */
class InlinePermissionPrompt(
    private val request: PermissionRequest,
    private val onReply: (reply: String) -> Unit
) : JPanel(BorderLayout()) {

    init {
        isOpaque = false
        border = BorderFactory.createEmptyBorder(8, 0, 8, 0)

        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        // Build tool call string like "bash(ls)"
        val toolType = request.permission.substringBefore(":").lowercase()
        val toolArg = request.metadata["command"]?.let { (it as? JsonPrimitive)?.content }
            ?: request.metadata["file_path"]?.let { (it as? JsonPrimitive)?.content }
            ?: request.metadata["path"]?.let { (it as? JsonPrimitive)?.content }
            ?: request.patterns.firstOrNull()
            ?: ""

        val toolCall = if (toolArg.isNotEmpty()) "$toolType($toolArg)" else toolType

        // Single line: "Running tool: bash(ls), do you want to proceed?"
        val headerText = "Running tool: $toolCall, do you want to proceed?"
        panel.add(JLabel(headerText).apply {
            alignmentX = LEFT_ALIGNMENT
        })
        panel.add(Box.createVerticalStrut(8))

        // Radio button options
        val buttonGroup = ButtonGroup()

        val yesOption = JRadioButton("Yes").apply {
            alignmentX = LEFT_ALIGNMENT
            isOpaque = false
            addActionListener { onReply("once") }
        }
        buttonGroup.add(yesOption)
        panel.add(yesOption)

        if (request.always.isNotEmpty()) {
            val alwaysText = "Yes, and don't ask again for ${request.always.joinToString(", ")}"
            val alwaysOption = JRadioButton(alwaysText).apply {
                alignmentX = LEFT_ALIGNMENT
                isOpaque = false
                addActionListener { onReply("always") }
            }
            buttonGroup.add(alwaysOption)
            panel.add(alwaysOption)
        }

        val noOption = JRadioButton("No").apply {
            alignmentX = LEFT_ALIGNMENT
            isOpaque = false
            addActionListener { onReply("reject") }
        }
        buttonGroup.add(noOption)
        panel.add(noOption)

        add(panel, BorderLayout.CENTER)
    }
}
