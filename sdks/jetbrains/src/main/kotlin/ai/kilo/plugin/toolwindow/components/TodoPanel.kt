package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.Todo
import ai.kilo.plugin.services.KiloSessionStore
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.openapi.Disposable
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JPanel

/**
 * Panel displaying todos for the current session.
 * 
 * Features (matching web client):
 * - Only visible when there are incomplete todos
 * - Collapsible when more than 2 items
 * - Shows status icons: [✓] completed, [•] in_progress, [ ] pending
 */
class TodoPanel(
    private val store: KiloSessionStore
) : JPanel(BorderLayout()), Disposable {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val headerPanel = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0))
    private val contentPanel = JPanel()
    private val expandIcon = JBLabel("▼")
    private val titleLabel = JBLabel("Todo")

    private var isExpanded = true
    private var currentTodos: List<Todo> = emptyList()

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.md, 0)
        isVisible = false // Hidden by default

        // Header
        headerPanel.isOpaque = false
        headerPanel.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)

        expandIcon.foreground = KiloTheme.textWeak
        expandIcon.font = expandIcon.font.deriveFont(KiloTypography.fontSizeXSmall - 1)
        expandIcon.isVisible = false // Only show when >2 items
        headerPanel.add(expandIcon)

        titleLabel.font = titleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeSmall)
        titleLabel.foreground = KiloTheme.textStrong
        headerPanel.add(titleLabel)

        headerPanel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (currentTodos.size > 2) {
                    toggleExpanded()
                }
            }
        })

        add(headerPanel, BorderLayout.NORTH)

        // Content
        contentPanel.layout = BoxLayout(contentPanel, BoxLayout.Y_AXIS)
        contentPanel.isOpaque = false
        contentPanel.border = JBUI.Borders.emptyLeft(KiloSpacing.xl)
        add(contentPanel, BorderLayout.CENTER)

        // Subscribe to todos
        subscribeToTodos()
    }

    private fun subscribeToTodos() {
        scope.launch {
            combine(
                store.currentSessionId,
                store.todos
            ) { sessionId, todosMap ->
                sessionId?.let { todosMap[it] } ?: emptyList()
            }.collectLatest { todos ->
                updateTodos(todos)
            }
        }
    }

    private fun updateTodos(todos: List<Todo>) {
        currentTodos = todos

        // Only show if there are incomplete todos
        val hasIncompleteTodos = todos.any { it.status != "completed" && it.status != "cancelled" }
        isVisible = hasIncompleteTodos

        if (!hasIncompleteTodos) {
            return
        }

        // Show expand icon if >2 items
        expandIcon.isVisible = todos.size > 2
        updateExpandIcon()

        // Update content
        contentPanel.removeAll()

        val todosToShow = if (isExpanded || todos.size <= 2) {
            todos
        } else {
            // When collapsed, show first 2
            todos.take(2)
        }

        for (todo in todosToShow) {
            val item = TodoItem(todo)
            item.alignmentX = LEFT_ALIGNMENT
            contentPanel.add(item)
        }

        // Show count if collapsed and more items
        if (!isExpanded && todos.size > 2) {
            val moreLabel = JBLabel("... and ${todos.size - 2} more").apply {
                foreground = KiloTheme.textWeak
                font = font.deriveFont(KiloTypography.fontSizeXSmall - 1)
                border = JBUI.Borders.emptyLeft(KiloSpacing.xs)
            }
            contentPanel.add(moreLabel)
        }

        contentPanel.revalidate()
        contentPanel.repaint()
    }

    private fun toggleExpanded() {
        isExpanded = !isExpanded
        updateExpandIcon()
        updateTodos(currentTodos)
    }

    private fun updateExpandIcon() {
        expandIcon.text = if (isExpanded) "▼" else "▶"
    }

    override fun dispose() {
        scope.cancel()
    }
}
