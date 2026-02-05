package ai.kilo.plugin.ui.components.chat.message

import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloSizes
import ai.kilo.plugin.ui.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.*
import java.awt.datatransfer.StringSelection
import javax.swing.*

/**
 * Entity types that can be rendered in the messages panel.
 * Naming convention: [Category:Type] to show parent-child relationship.
 */
sealed class SessionEntityType(val icon: Icon?) {
    abstract val displayName: String

    // Message-level entities
    data class UserMessage(
        val agent: String?,
        val modelId: String?,
        val providerId: String?
    ) : SessionEntityType(AllIcons.General.User) {
        override val displayName: String get() = "[Message:User]"

        val agentDisplay: String? get() = agent?.replaceFirstChar { it.uppercase() }
        val modelDisplay: String? get() = modelId
    }
    data class AssistantMessage(val model: String?) : SessionEntityType(AllIcons.Nodes.Favorite) {
        override val displayName: String get() = "[Message:Assistant]"
    }

    // Part-level entities (children of messages)
    data class Text(val callId: String?) : SessionEntityType(AllIcons.FileTypes.Text) {
        override val displayName: String get() = "[Part:Text]"
    }
    data class Reasoning(val callId: String?) : SessionEntityType(AllIcons.General.InspectionsEye) {
        override val displayName: String get() = "[Part:Reasoning]"
    }
    data class StepStart(val callId: String?) : SessionEntityType(AllIcons.Actions.Execute) {
        override val displayName: String get() = "[Part:StepStart]"
    }
    data class StepFinish(val callId: String?, val reason: String?) : SessionEntityType(AllIcons.Actions.Checked) {
        override val displayName: String get() = "[Part:StepFinish]"
    }

    // Tool entities (part.type === "tool", subtype by part.tool)
    data class ToolRead(val callId: String?, val filePath: String?) : SessionEntityType(AllIcons.Actions.Preview) {
        override val displayName: String get() = "[Part:Tool:Read]"
    }
    data class ToolWrite(val callId: String?, val filePath: String?) : SessionEntityType(AllIcons.Actions.New) {
        override val displayName: String get() = "[Part:Tool:Write]"
    }
    data class ToolEdit(val callId: String?, val filePath: String?) : SessionEntityType(AllIcons.Actions.Edit) {
        override val displayName: String get() = "[Part:Tool:Edit]"
    }
    data class ToolBash(val callId: String?, val command: String?) : SessionEntityType(AllIcons.Debugger.Console) {
        override val displayName: String get() = "[Part:Tool:Bash]"
    }
    data class ToolGlob(val callId: String?, val pattern: String?) : SessionEntityType(AllIcons.Actions.Find) {
        override val displayName: String get() = "[Part:Tool:Glob]"
    }
    data class ToolGrep(val callId: String?, val pattern: String?) : SessionEntityType(AllIcons.Actions.Search) {
        override val displayName: String get() = "[Part:Tool:Grep]"
    }
    data class ToolList(val callId: String?, val path: String?) : SessionEntityType(AllIcons.Nodes.Folder) {
        override val displayName: String get() = "[Part:Tool:List]"
    }
    data class ToolWebFetch(val callId: String?, val url: String?) : SessionEntityType(AllIcons.General.Web) {
        override val displayName: String get() = "[Part:Tool:WebFetch]"
    }
    data class ToolWebSearch(val callId: String?, val query: String?) : SessionEntityType(AllIcons.Actions.Search) {
        override val displayName: String get() = "[Part:Tool:WebSearch]"
    }
    data class ToolTask(val callId: String?, val description: String?) : SessionEntityType(AllIcons.Nodes.Module) {
        override val displayName: String get() = "[Part:Tool:Task]"
    }
    data class ToolTodoRead(val callId: String?) : SessionEntityType(AllIcons.General.TodoDefault) {
        override val displayName: String get() = "[Part:Tool:TodoRead]"
    }
    data class ToolTodoWrite(val callId: String?) : SessionEntityType(AllIcons.General.TodoDefault) {
        override val displayName: String get() = "[Part:Tool:TodoWrite]"
    }
    data class ToolApplyPatch(val callId: String?) : SessionEntityType(AllIcons.Vcs.Patch) {
        override val displayName: String get() = "[Part:Tool:ApplyPatch]"
    }
    data class ToolGeneric(val callId: String?, val toolName: String) : SessionEntityType(AllIcons.Nodes.Plugin) {
        override val displayName: String get() = "[Part:Tool:$toolName]"
    }

    // Permission & Question entities (associated with tools, showing full context)
    data class Permission(val requestId: String, val toolName: String?) : SessionEntityType(AllIcons.General.Warning) {
        override val displayName: String get() = if (toolName != null) "[Part:Tool:$toolName → Permission]" else "[Part:Tool → Permission]"
    }
    data class Question(val requestId: String, val toolName: String?, val questionText: String?) : SessionEntityType(AllIcons.General.QuestionDialog) {
        override val displayName: String get() = if (toolName != null) "[Part:Tool:$toolName → Question]" else "[Part:Tool → Question]"
    }

    // Other part types
    data class File(val callId: String?, val fileName: String?) : SessionEntityType(AllIcons.FileTypes.Any_type) {
        override val displayName: String get() = "[Part:File]"
    }
    data class Agent(val callId: String?, val agentName: String?) : SessionEntityType(AllIcons.General.User) {
        override val displayName: String get() = if (agentName != null) "[Part:Agent:$agentName]" else "[Part:Agent]"
    }
    data class Subtask(val callId: String?) : SessionEntityType(AllIcons.Nodes.Module) {
        override val displayName: String get() = "[Part:Subtask]"
    }
    data class Snapshot(val callId: String?) : SessionEntityType(AllIcons.Vcs.History) {
        override val displayName: String get() = "[Part:Snapshot]"
    }
    data class Patch(val callId: String?) : SessionEntityType(AllIcons.Vcs.Patch) {
        override val displayName: String get() = "[Part:Patch]"
    }
    data class Retry(val callId: String?, val attempt: Int?) : SessionEntityType(AllIcons.General.BalloonWarning) {
        override val displayName: String get() = if (attempt != null) "[Part:Retry:$attempt]" else "[Part:Retry]"
    }
    data class Compaction(val callId: String?) : SessionEntityType(AllIcons.Actions.Collapseall) {
        override val displayName: String get() = "[Part:Compaction]"
    }

    // Fallback
    data class Unknown(val typeName: String, val callId: String?) : SessionEntityType(AllIcons.General.Information) {
        override val displayName: String get() = "[Part:Unknown:$typeName]"
    }
}

/**
 * Data class for footer information displayed at the bottom of a ChatContentBlock.
 */
data class BlockFooterInfo(
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val cacheReadTokens: Int? = null,
    val cacheWriteTokens: Int? = null,
    val copyableContent: String? = null,
    val additionalActions: List<FooterAction> = emptyList()
) {
    fun hasContent(): Boolean =
        inputTokens != null ||
        outputTokens != null ||
        cacheReadTokens != null ||
        cacheWriteTokens != null ||
        copyableContent != null ||
        additionalActions.isNotEmpty()
}

/**
 * Represents a custom action button in the footer.
 */
data class FooterAction(
    val label: String,
    val icon: Icon? = null,
    val tooltip: String? = null,
    val onClick: () -> Unit
)

/**
 * Generic collapsible UI container for chat entities (messages, parts, tools, etc.).
 *
 * ┌──────────────────────────────────────────────────┐
 * │  Header: [EntityType] · metadata · +time     [▼] │
 * ├──────────────────────────────────────────────────┤
 * │  Content: (any JComponent)                       │
 * ├──────────────────────────────────────────────────┤
 * │  Footer: in: 1.2K · out: 856        [Copy] [...] │
 * └──────────────────────────────────────────────────┘
 *
 * The footer is optional and only shown when [BlockFooterInfo] is provided.
 */
class ChatContentBlock(
    private val entityType: SessionEntityType,
    private val content: JComponent,
    private val timestamp: Long? = null,
    private val sessionStartTime: Long? = null,
    initiallyCollapsed: Boolean = false,
    private val footerInfo: BlockFooterInfo? = null
) : BorderLayoutPanel() {

    private var isCollapsed = initiallyCollapsed
    private val contentBlock: JPanel
    private val footerBlock: JPanel?
    private val collapseIcon: JBLabel
    private lateinit var header: JPanel
    private lateinit var stackedPanel: JPanel

    init {
        isOpaque = false
        border = if (KiloTheme.UI_DEBUG) JBUI.Borders.customLine(KiloTheme.borderWeak, 1) else JBUI.Borders.empty()

        stackedPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        // Click handler for toggle
        val clickListener = object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                toggleCollapsed()
            }
        }

        // Collapse/expand icon
        collapseIcon = JBLabel(if (isCollapsed) AllIcons.General.ArrowRight else AllIcons.General.ArrowDown).apply {
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            toolTipText = if (isCollapsed) "Expand" else "Collapse"
            addMouseListener(clickListener)
        }

        // Header block with BorderLayout for left content and right icon
        header = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = if (KiloTheme.UI_DEBUG) {
                BorderFactory.createCompoundBorder(
                    JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
                    JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
                )
            } else {
                JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
            }
            alignmentX = Component.LEFT_ALIGNMENT
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

            // Left side: entity type, metadata, and timestamp
            val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
                isOpaque = false
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

                // Main display name
                add(JBLabel(entityType.displayName).apply {
                    foreground = KiloTheme.textWeak
                    addMouseListener(clickListener)
                })

                // For user messages, show agent and model info
                if (entityType is SessionEntityType.UserMessage) {
                    val userMsg = entityType
                    // Show agent if present
                    userMsg.agentDisplay?.let { agent ->
                        add(JBLabel("·").apply { foreground = KiloTheme.textWeaker })
                        add(JBLabel(agent).apply {
                            foreground = KiloTheme.textWeak
                            addMouseListener(clickListener)
                        })
                    }
                    // Show model if present
                    userMsg.modelDisplay?.let { model ->
                        add(JBLabel("·").apply { foreground = KiloTheme.textWeaker })
                        add(JBLabel(model).apply {
                            foreground = KiloTheme.textWeak
                            addMouseListener(clickListener)
                        })
                    }
                }

                // Timestamp
                if (timestamp != null && sessionStartTime != null) {
                    val formatted = formatOffsetTime(timestamp, sessionStartTime)
                    add(JBLabel("·").apply { foreground = KiloTheme.textWeaker })
                    add(JBLabel(formatted).apply {
                        foreground = KiloTheme.textWeaker
                        addMouseListener(clickListener)
                    })
                }
                addMouseListener(clickListener)
            }
            add(leftPanel, BorderLayout.CENTER)

            // Right side: collapse icon
            val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, 0, 0)).apply {
                isOpaque = false
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                add(collapseIcon)
                addMouseListener(clickListener)
            }
            add(rightPanel, BorderLayout.EAST)

            addMouseListener(clickListener)
        }
        // Only show header in debug mode
        if (KiloTheme.UI_DEBUG) {
            stackedPanel.add(header)
        }

        // Content block
        contentBlock = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.xxs, KiloSpacing.xs)
            alignmentX = Component.LEFT_ALIGNMENT
            add(content, BorderLayout.CENTER)
            isVisible = !isCollapsed
        }
        stackedPanel.add(contentBlock)

        // Footer block (optional)
        footerBlock = if (footerInfo != null && footerInfo.hasContent()) {
            createFooterPanel(footerInfo).apply {
                alignmentX = Component.LEFT_ALIGNMENT
                isVisible = !isCollapsed
            }
        } else null
        footerBlock?.let { stackedPanel.add(it) }

        addToCenter(stackedPanel)
    }

    private fun createFooterPanel(info: BlockFooterInfo): JPanel {
        return JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = if (KiloTheme.UI_DEBUG) {
                BorderFactory.createCompoundBorder(
                    JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, 0, 0),
                    JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
                )
            } else {
                JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
            }

            // Left side: token info
            val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.sm, 0)).apply {
                isOpaque = false

                // Token info
                val tokenParts = mutableListOf<String>()
                info.inputTokens?.let { tokenParts.add("in: ${formatTokenCount(it)}") }
                info.outputTokens?.let { tokenParts.add("out: ${formatTokenCount(it)}") }
                info.cacheReadTokens?.let { if (it > 0) tokenParts.add("cache↓: ${formatTokenCount(it)}") }
                info.cacheWriteTokens?.let { if (it > 0) tokenParts.add("cache↑: ${formatTokenCount(it)}") }

                if (tokenParts.isNotEmpty()) {
                    add(JBLabel(tokenParts.joinToString(" · ")).apply {
                        foreground = KiloTheme.textWeaker
                        font = font.deriveFont(KiloTypography.fontSizeSmall)
                    })
                }
            }
            add(leftPanel, BorderLayout.CENTER)

            // Right side: action buttons
            val rightPanel = JPanel(FlowLayout(FlowLayout.RIGHT, KiloSpacing.xs, 0)).apply {
                isOpaque = false

                // Copy button
                if (info.copyableContent != null) {
                    add(createActionButton("Copy", AllIcons.Actions.Copy, "Copy to clipboard") {
                        val clipboard = Toolkit.getDefaultToolkit().systemClipboard
                        clipboard.setContents(StringSelection(info.copyableContent), null)
                    })
                }

                // Additional custom actions
                info.additionalActions.forEach { action ->
                    add(createActionButton(action.label, action.icon, action.tooltip, action.onClick))
                }
            }
            add(rightPanel, BorderLayout.EAST)
        }
    }

    private fun createActionButton(
        label: String,
        icon: Icon?,
        tooltip: String?,
        onClick: () -> Unit
    ): JButton {
        return JButton(label, icon).apply {
            this.toolTipText = tooltip
            isFocusPainted = false
            isBorderPainted = false
            isContentAreaFilled = false
            foreground = KiloTheme.textWeak
            font = font.deriveFont(KiloTypography.fontSizeSmall)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            preferredSize = Dimension(
                preferredSize.width,
                KiloSizes.buttonHeightSm
            )

            addMouseListener(object : java.awt.event.MouseAdapter() {
                override fun mouseEntered(e: java.awt.event.MouseEvent) {
                    foreground = KiloTheme.textInteractive
                }
                override fun mouseExited(e: java.awt.event.MouseEvent) {
                    foreground = KiloTheme.textWeak
                }
            })

            addActionListener { onClick() }
        }
    }

    private fun toggleCollapsed() {
        isCollapsed = !isCollapsed
        contentBlock.isVisible = !isCollapsed
        footerBlock?.isVisible = !isCollapsed
        collapseIcon.icon = if (isCollapsed) AllIcons.General.ArrowRight else AllIcons.General.ArrowDown
        collapseIcon.toolTipText = if (isCollapsed) "Expand" else "Collapse"
        revalidate()
        repaint()
    }

    /**
     * Update debug mode visuals. Called by renderer when UI_DEBUG changes.
     */
    fun updateDebugMode(debug: Boolean) {
        // Update outer border
        border = if (debug) JBUI.Borders.customLine(KiloTheme.borderWeak, 1) else JBUI.Borders.empty()

        // Update header visibility
        if (debug && header.parent == null) {
            stackedPanel.add(header, 0)
        } else if (!debug && header.parent != null) {
            stackedPanel.remove(header)
        }

        // Update header border
        header.border = if (debug) {
            BorderFactory.createCompoundBorder(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
                JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
            )
        } else {
            JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
        }

        // Update footer border
        footerBlock?.border = if (debug) {
            BorderFactory.createCompoundBorder(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, 0, 0),
                JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
            )
        } else {
            JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
        }
    }

    fun setCollapsed(collapsed: Boolean) {
        if (isCollapsed != collapsed) {
            toggleCollapsed()
        }
    }

    fun isCollapsed(): Boolean = isCollapsed

    override fun getMaximumSize(): Dimension {
        val pref = preferredSize
        return Dimension(Int.MAX_VALUE, pref.height)
    }

    companion object {
        /**
         * Format timestamp as offset from session start: +23ms, +1.2s, +65.3s, +2:05
         */
        fun formatOffsetTime(timestamp: Long, sessionStartTime: Long): String {
            val offsetMs = (timestamp - sessionStartTime).coerceAtLeast(0)

            return when {
                // Show milliseconds for < 1 second
                offsetMs < 1000 -> "+${offsetMs}ms"
                // Show seconds with 1 decimal for < 1 minute
                offsetMs < 60000 -> "+%.1fs".format(offsetMs / 1000.0)
                // Show minutes:seconds for >= 1 minute
                else -> {
                    val minutes = offsetMs / 60000
                    val secs = (offsetMs % 60000) / 1000
                    "+%d:%02d".format(minutes, secs)
                }
            }
        }

        /**
         * Format token count with K suffix for large numbers.
         */
        fun formatTokenCount(count: Int): String {
            return when {
                count >= 1_000_000 -> "%.1fM".format(count / 1_000_000.0)
                count >= 10_000 -> "%.0fK".format(count / 1_000.0)
                count >= 1_000 -> "%.1fK".format(count / 1_000.0)
                else -> count.toString()
            }
        }
    }
}
