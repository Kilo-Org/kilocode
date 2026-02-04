package ai.kilo.plugin.ui.components.chat.message.parts

import ai.kilo.plugin.model.Part
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTypography
import ai.kilo.plugin.ui.KiloRadius
import com.intellij.icons.AllIcons
import com.intellij.ide.CopyPasteManagerEx
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.datatransfer.StringSelection
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*

/**
 * A collapsible panel for displaying tool call information.
 * Shows tool name, status, and expandable input/output sections.
 */
class CollapsibleToolPanel(
    private val part: Part
) : JPanel(BorderLayout()) {

    private var isExpanded = false
    private val contentPanel: JPanel
    private val expandIcon = JBLabel()
    private val headerPanel: JPanel

    // Tool state from part
    private val status = part.toolStatus ?: "pending"
    private val title = part.toolTitle ?: formatToolName(part.tool ?: "Unknown")
    private val output = part.toolOutput
    private val error = part.toolError

    init {
        isOpaque = false
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(KiloTheme.borderWeak),
            JBUI.Borders.empty(0)
        )

        // Header (always visible)
        headerPanel = createHeader()
        add(headerPanel, BorderLayout.NORTH)

        // Content (collapsible)
        contentPanel = createContent()
        contentPanel.isVisible = false
        add(contentPanel, BorderLayout.CENTER)

        // Auto-expand if there's an error
        if (error != null) {
            toggleExpanded()
        }
    }

    private fun createHeader(): JPanel {
        val panel = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = JBUI.Borders.empty(KiloSpacing.sm, KiloSpacing.md)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        // Left side: expand icon + status icon + title
        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
            isOpaque = false
        }

        // Expand/collapse icon
        expandIcon.icon = AllIcons.General.ArrowRight
        leftPanel.add(expandIcon)

        // Status icon
        val statusIcon = createStatusIcon()
        leftPanel.add(statusIcon)

        // Title
        val titleLabel = JBLabel(title).apply {
            font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeXSmall)
            foreground = KiloTheme.textStrong
        }
        leftPanel.add(titleLabel)

        panel.add(leftPanel, BorderLayout.WEST)

        // Right side: status text
        val statusText = when (status) {
            "pending" -> "Pending"
            "running" -> "Running..."
            "completed" -> "Completed"
            "error" -> "Error"
            else -> status
        }
        val statusLabel = JBLabel(statusText).apply {
            foreground = when (status) {
                "error" -> KiloTheme.textCritical
                "running" -> KiloTheme.textInteractive
                "completed" -> KiloTheme.textSuccess
                else -> KiloTheme.textWeak
            }
            font = font.deriveFont(KiloTypography.fontSizeXSmall - 1)
        }
        panel.add(statusLabel, BorderLayout.EAST)

        // Click to expand/collapse
        panel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                toggleExpanded()
            }
            override fun mouseEntered(e: MouseEvent) {
                panel.background = KiloTheme.surfaceRaisedStrong
            }
            override fun mouseExited(e: MouseEvent) {
                panel.background = KiloTheme.surfaceRaisedBase
            }
        })

        return panel
    }

    private fun createStatusIcon(): JComponent {
        return when (status) {
            "pending" -> JBLabel(AllIcons.Process.Step_1)
            "running" -> JBLabel(AnimatedIcon.Default())
            "completed" -> JBLabel(AllIcons.Actions.Checked)
            "error" -> JBLabel(AllIcons.General.Error)
            else -> JBLabel(AllIcons.Process.Step_1)
        }
    }

    private fun createContent(): JPanel {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = true
            background = KiloTheme.backgroundStronger
            border = JBUI.Borders.empty(KiloSpacing.md)
        }

        // Tool input parameters (if available from metadata)
        val metadata = part.metadata
        if (metadata != null && metadata.isNotEmpty()) {
            panel.add(createSection("Input", formatMetadata(metadata)))
            panel.add(Box.createVerticalStrut(KiloSpacing.md))
        }

        // Tool output
        if (output != null && output.isNotBlank()) {
            panel.add(createSection("Output", output))
        }

        // Error message
        if (error != null && error.isNotBlank()) {
            panel.add(createSection("Error", error, isError = true))
        }

        // If no content, show placeholder
        if (panel.componentCount == 0) {
            val placeholder = JBLabel("No output available").apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(Font.ITALIC, KiloTypography.fontSizeXSmall)
            }
            panel.add(placeholder)
        }

        return panel
    }

    private fun createSection(title: String, content: String, isError: Boolean = false): JPanel {
        val section = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(0, 0, KiloSpacing.xs, 0)
        }

        // Section header with copy button
        val header = JPanel(BorderLayout()).apply {
            isOpaque = false
        }

        val titleLabel = JBLabel(title).apply {
            foreground = if (isError) KiloTheme.textCritical else KiloTheme.textWeak
            font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeXSmall - 1)
        }
        header.add(titleLabel, BorderLayout.WEST)

        val copyButton = JButton("Copy").apply {
            font = font.deriveFont(KiloTypography.fontSizeXSmall - 2)
            isFocusable = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            isContentAreaFilled = false
            isBorderPainted = false
            foreground = KiloTheme.textWeak
            preferredSize = Dimension(40, 16)

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    foreground = KiloTheme.textStrong
                }
                override fun mouseExited(e: MouseEvent) {
                    foreground = KiloTheme.textWeak
                }
            })

            addActionListener {
                CopyPasteManagerEx.getInstance().setContents(StringSelection(content))
                text = "Copied!"
                Timer(1500) { text = "Copy" }.apply {
                    isRepeats = false
                    start()
                }
            }
        }
        header.add(copyButton, BorderLayout.EAST)

        section.add(header, BorderLayout.NORTH)

        // Content area
        val scheme = EditorColorsManager.getInstance().globalScheme
        val editorFont = scheme.getFont(EditorFontType.PLAIN)

        // Code block colors from theme
        val codeBg = KiloTheme.surfaceInsetBase
        val codeText = if (isError) KiloTheme.textCritical else KiloTheme.textBase
        
        val textArea = JTextArea(content).apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
            isOpaque = true
            background = codeBg
            foreground = codeText
            font = Font(editorFont.family, Font.PLAIN, KiloTypography.fontSizeXSmall.toInt())
            border = JBUI.Borders.empty(KiloSpacing.md)
            tabSize = 2

            // Limit initial display height
            rows = minOf(content.lines().size, 15)
        }

        val scrollPane = JScrollPane(textArea).apply {
            border = JBUI.Borders.customLine(KiloTheme.borderWeak)
            preferredSize = Dimension(Int.MAX_VALUE, minOf(textArea.preferredSize.height + 16, 300))
            maximumSize = Dimension(Int.MAX_VALUE, 300)
        }

        section.add(scrollPane, BorderLayout.CENTER)

        return section
    }

    private fun formatMetadata(metadata: kotlinx.serialization.json.JsonObject): String {
        return metadata.entries.joinToString("\n") { (key, value) ->
            "$key: $value"
        }
    }

    private fun toggleExpanded() {
        isExpanded = !isExpanded
        contentPanel.isVisible = isExpanded
        expandIcon.icon = if (isExpanded) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        revalidate()
        repaint()
    }

    companion object {
        /**
         * Format tool name to human-readable title.
         */
        fun formatToolName(toolName: String): String {
            return when (toolName.lowercase()) {
                "read" -> "Read File"
                "write" -> "Write File"
                "edit" -> "Edit File"
                "bash" -> "Run Command"
                "glob" -> "Find Files"
                "grep" -> "Search Content"
                "task" -> "Sub-task"
                "webfetch" -> "Fetch URL"
                "websearch" -> "Web Search"
                "todowrite" -> "Update Todos"
                "todoread" -> "Read Todos"
                "question" -> "Ask Question"
                else -> toolName.replaceFirstChar { it.uppercase() }
            }
        }
    }
}
