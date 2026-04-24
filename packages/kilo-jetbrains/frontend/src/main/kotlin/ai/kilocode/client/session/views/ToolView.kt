package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout

/**
 * Renders a [Tool] part as a compact one-line header.
 *
 * Shows a state icon, the tool name, and when available a descriptive
 * title — mirroring VS Code's basic-tool card without the expandable
 * output slot (output details can be added later when the RPC carries
 * structured tool output).
 *
 * State icons:
 * - ⏳ PENDING
 * - ▶ RUNNING
 * - ✓ COMPLETED
 * - ✗ ERROR
 */
class ToolView(tool: Tool) : PartView() {

    override val contentId: String = tool.id

    private val label = JBLabel().apply {
        foreground = UIUtil.getContextHelpForeground()
        font = JBUI.Fonts.smallFont()
        border = JBUI.Borders.empty(2, 0)
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        add(label, BorderLayout.CENTER)
        render(tool)
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        render(content)
    }

    /** Exposed for tests to assert the displayed label text. */
    fun labelText(): String = label.text

    private fun render(tool: Tool) {
        val icon = when (tool.state) {
            ToolExecState.PENDING -> "\u23F3"    // ⏳
            ToolExecState.RUNNING -> "\u25B6"    // ▶
            ToolExecState.COMPLETED -> "\u2713"  // ✓
            ToolExecState.ERROR -> "\u2717"      // ✗
        }
        val display = tool.title?.takeIf { it.isNotBlank() } ?: tool.name
        label.text = "$icon $display"
    }

    override fun dumpLabel() = "ToolView#$contentId(${label.text})"
}
