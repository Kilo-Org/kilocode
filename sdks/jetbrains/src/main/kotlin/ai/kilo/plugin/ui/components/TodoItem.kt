package ai.kilo.plugin.ui.components

import ai.kilo.plugin.model.Todo
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import javax.swing.JPanel

/**
 * Individual todo item component.
 * Displays status icon and content text.
 * 
 * Status icons (matching web client):
 * - completed: [✓] gray
 * - in_progress: [•] warning/yellow color
 * - pending: [ ] gray
 */
class TodoItem(private val todo: Todo) : JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, KiloSpacing.xxs)) {

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.xxs, 0)

        // Status indicator - use lowercase for matching
        val statusLower = todo.status?.lowercase()
        val color = when (statusLower) {
            "completed" -> KiloTheme.textWeak
            "in_progress" -> KiloTheme.iconWarningActive
            "pending" -> KiloTheme.textWeak
            "cancelled" -> KiloTheme.textWeaker
            else -> KiloTheme.textWeak
        }

        // Status icon
        val statusLabel = JBLabel(getStatusText(todo.status)).apply {
            foreground = color
            font = font.deriveFont(KiloTypography.fontSizeXSmall)
        }
        add(statusLabel)

        // Content
        val contentLabel = JBLabel(todo.content ?: "").apply {
            foreground = color
            font = font.deriveFont(KiloTypography.fontSizeXSmall)
            // Strikethrough for completed
            if (statusLower == "completed" || statusLower == "cancelled") {
                text = "<html><s>${todo.content ?: ""}</s></html>"
            }
        }
        add(contentLabel)
    }

    private fun getStatusText(status: String?): String {
        return when (status?.lowercase()) {
            "completed" -> "[✓]"
            "in_progress" -> "[•]"
            "pending" -> "[ ]"
            "cancelled" -> "[✗]"
            null, "" -> "[?]"
            else -> "[$status]" // Show unknown status for debugging
        }
    }
}
