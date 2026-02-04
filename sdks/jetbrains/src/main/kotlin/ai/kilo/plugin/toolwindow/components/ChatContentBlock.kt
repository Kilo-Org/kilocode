package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.*
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
 * Generic collapsible UI container for chat entities (messages, parts, tools, etc.).
 *
 * ┌─────────────────────────────────────────────┐
 * │  Header: [EntityType] · metadata · +time [▼] │
 * ├─────────────────────────────────────────────┤
 * │  Content: (any JComponent)                  │
 * └─────────────────────────────────────────────┘
 */
class ChatContentBlock(
    private val entityType: SessionEntityType,
    private val content: JComponent,
    private val timestamp: Long? = null,
    private val sessionStartTime: Long? = null,
    initiallyCollapsed: Boolean = false
) : BorderLayoutPanel() {

    private var isCollapsed = initiallyCollapsed
    private val contentBlock: JPanel
    private val collapseIcon: JBLabel

    init {
        isOpaque = false
        border = JBUI.Borders.customLine(KiloTheme.borderWeak, 1)

        val stackedPanel = JPanel().apply {
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
        val header = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = BorderFactory.createCompoundBorder(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
                JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.sm)
            )
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
        stackedPanel.add(header)

        // Content block
        contentBlock = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(KiloSpacing.xxs, KiloSpacing.xs)
            alignmentX = Component.LEFT_ALIGNMENT
            add(content, BorderLayout.CENTER)
            isVisible = !isCollapsed
        }
        stackedPanel.add(contentBlock)

        addToCenter(stackedPanel)
    }

    private fun toggleCollapsed() {
        isCollapsed = !isCollapsed
        contentBlock.isVisible = !isCollapsed
        collapseIcon.icon = if (isCollapsed) AllIcons.General.ArrowRight else AllIcons.General.ArrowDown
        collapseIcon.toolTipText = if (isCollapsed) "Expand" else "Collapse"
        revalidate()
        repaint()
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
    }
}
