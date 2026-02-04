package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.Session
import ai.kilo.plugin.model.SessionStatus
import ai.kilo.plugin.services.ChatUiStateManager
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import java.awt.BorderLayout
import java.awt.Component
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.KeyEvent
import java.text.SimpleDateFormat
import java.util.*
import javax.swing.*
import javax.swing.KeyStroke

/**
 * Panel displaying the list of chat sessions.
 *
 * @param onSessionSelected Callback invoked when a session is selected (to switch back to chat view)
 */
class SessionListPanel(
    private val project: Project,
    private val store: ChatUiStateManager,
    private val onSessionSelected: (() -> Unit)? = null
) : JPanel(BorderLayout()) {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val sessionListModel = DefaultListModel<Session>()
    private val sessionList = JBList(sessionListModel)

    private var sessionStatuses: Map<String, SessionStatus> = emptyMap()
    private var selectedSessionId: String? = null

    init {
        border = JBUI.Borders.empty()
        isOpaque = true
        background = KiloTheme.backgroundStronger

        // Setup list (no toolbar - actions are in main header now)
        setupList()
        val scrollPane = JBScrollPane(sessionList).apply {
            isOpaque = true
            viewport.isOpaque = true
            viewport.background = KiloTheme.backgroundStronger
            background = KiloTheme.backgroundStronger
        }
        add(scrollPane, BorderLayout.CENTER)

        // Subscribe to state changes
        subscribeToState()
    }

    private fun setupList() {
        sessionList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        sessionList.cellRenderer = SessionCellRenderer()
        sessionList.fixedCellHeight = KiloSizes.sessionCellHeight // 36px matching web client
        sessionList.background = KiloTheme.backgroundStronger

        // Selection listener
        sessionList.addListSelectionListener { e ->
            if (!e.valueIsAdjusting) {
                val selected = sessionList.selectedValue
                if (selected != null && selected.id != selectedSessionId) {
                    selectedSessionId = selected.id
                    scope.launch {
                        store.selectSession(selected.id)
                    }
                    // Switch back to chat view
                    onSessionSelected?.invoke()
                }
            }
        }

        // Double-click to rename
        sessionList.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) {
                    val index = sessionList.locationToIndex(e.point)
                    if (index >= 0) {
                        // Could implement inline rename here
                    }
                }
            }
        })

        // Context menu
        sessionList.componentPopupMenu = createContextMenu()

        // Keyboard bindings
        sessionList.inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_DELETE, 0), "deleteSession")
        sessionList.inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_F6, KeyEvent.SHIFT_DOWN_MASK), "renameSession")
        sessionList.actionMap.put("deleteSession", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                sessionList.selectedValue?.let { deleteSession(it) }
            }
        })
        sessionList.actionMap.put("renameSession", object : AbstractAction() {
            override fun actionPerformed(e: java.awt.event.ActionEvent?) {
                sessionList.selectedValue?.let { renameSession(it) }
            }
        })
    }

    private fun createContextMenu(): JPopupMenu {
        return JPopupMenu().apply {
            add(JMenuItem("Rename", AllIcons.Actions.Edit).apply {
                accelerator = KeyStroke.getKeyStroke("shift F6")
                addActionListener {
                    val selected = sessionList.selectedValue ?: return@addActionListener
                    renameSession(selected)
                }
            })
            add(JMenuItem("Delete Chat", AllIcons.Actions.GC).apply {
                accelerator = KeyStroke.getKeyStroke("DELETE")
                addActionListener {
                    val selected = sessionList.selectedValue ?: return@addActionListener
                    deleteSession(selected)
                }
            })
        }
    }

    private fun renameSession(session: Session) {
        val newTitle = JOptionPane.showInputDialog(
            this,
            "Enter new session title:",
            "Rename Session",
            JOptionPane.PLAIN_MESSAGE,
            null,
            null,
            session.title
        ) as? String

        if (!newTitle.isNullOrBlank() && newTitle != session.title) {
            scope.launch {
                store.renameSession(session.id, newTitle)
            }
        }
    }

    private fun deleteSession(session: Session) {
        val confirm = JOptionPane.showConfirmDialog(
            this,
            "Delete session '${session.title}'? This cannot be undone.",
            "Delete Session",
            JOptionPane.YES_NO_OPTION,
            JOptionPane.WARNING_MESSAGE
        )

        if (confirm == JOptionPane.YES_OPTION) {
            scope.launch {
                store.deleteSession(session.id)
            }
        }
    }

    private fun subscribeToState() {
        // Subscribe to sessions and statuses
        scope.launch {
            combine(
                store.sessions,
                store.sessionStatuses
            ) { sessions, statuses ->
                Pair(sessions, statuses)
            }.collectLatest { (sessions, statuses) ->
                sessionStatuses = statuses
                updateSessionList(sessions)
            }
        }

        // Subscribe to current session selection
        scope.launch {
            store.currentSessionId.collectLatest { sessionId ->
                selectedSessionId = sessionId
                if (sessionId != null) {
                    val index = (0 until sessionListModel.size()).firstOrNull {
                        sessionListModel.getElementAt(it).id == sessionId
                    }
                    if (index != null && sessionList.selectedIndex != index) {
                        sessionList.selectedIndex = index
                    }
                }
            }
        }
    }

    private fun updateSessionList(sessions: List<Session>) {
        val currentSelection = sessionList.selectedValue?.id
        
        // Filter and sort sessions
        val filteredSessions = sessions
            .filter { it.time.archived == null }
            .sortedByDescending { it.time.updated }
        
        // Check if we need to update (avoid unnecessary repaints)
        val currentIds = (0 until sessionListModel.size()).map { sessionListModel.getElementAt(it).id }
        val newIds = filteredSessions.map { it.id }
        
        if (currentIds == newIds) {
            // Same sessions, just update existing elements in place
            for (i in filteredSessions.indices) {
                if (i < sessionListModel.size()) {
                    val existing = sessionListModel.getElementAt(i)
                    val updated = filteredSessions[i]
                    if (existing.time.updated != updated.time.updated || existing.title != updated.title) {
                        sessionListModel.setElementAt(updated, i)
                    }
                }
            }
            return
        }

        // Different sessions, do full update
        sessionListModel.clear()
        filteredSessions.forEach { sessionListModel.addElement(it) }

        // Restore selection
        if (currentSelection != null) {
            val index = (0 until sessionListModel.size()).firstOrNull {
                sessionListModel.getElementAt(it).id == currentSelection
            }
            if (index != null) {
                sessionList.selectedIndex = index
            }
        }
    }

    private inner class SessionCellRenderer : ListCellRenderer<Session> {
        private val dateFormat = SimpleDateFormat("MMM d, h:mm a")

        private val panel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(KiloSpacing.xs, KiloSpacing.md)
        }
        private val titleLabel = JLabel()
        private val dateLabel = JLabel().apply {
            foreground = KiloTheme.textWeak
        }

        init {
            panel.add(titleLabel, BorderLayout.CENTER)
            panel.add(dateLabel, BorderLayout.EAST)
        }

        override fun getListCellRendererComponent(
            list: JList<out Session>,
            value: Session,
            index: Int,
            isSelected: Boolean,
            cellHasFocus: Boolean
        ): Component {
            // Background styling
            panel.background = if (isSelected) KiloTheme.surfaceInteractive else KiloTheme.backgroundStronger
            panel.isOpaque = true

            // Title
            titleLabel.text = value.title.ifBlank { "Untitled" }
            titleLabel.foreground = if (isSelected) KiloTheme.textStrong else KiloTheme.textStrong

            // Date - format like "Yesterday 8:59 PM" or "Jan 5, 3:30 PM"
            val dateText = formatRelativeDate(value.time.updated)

            // Status indicator
            val status = sessionStatuses[value.id]
            dateLabel.text = if (status?.type == "busy") "$dateText ●" else dateText
            dateLabel.foreground = if (status?.type == "busy") KiloTheme.iconInteractive else KiloTheme.textWeak

            return panel
        }

        private fun formatRelativeDate(timestamp: Long): String {
            val now = Calendar.getInstance()
            val date = Calendar.getInstance().apply { timeInMillis = timestamp }
            val timeFormat = SimpleDateFormat("h:mm a")

            return when {
                isSameDay(now, date) -> "Today ${timeFormat.format(Date(timestamp))}"
                isYesterday(now, date) -> "Yesterday ${timeFormat.format(Date(timestamp))}"
                else -> dateFormat.format(Date(timestamp))
            }
        }

        private fun isSameDay(cal1: Calendar, cal2: Calendar): Boolean {
            return cal1.get(Calendar.YEAR) == cal2.get(Calendar.YEAR) &&
                   cal1.get(Calendar.DAY_OF_YEAR) == cal2.get(Calendar.DAY_OF_YEAR)
        }

        private fun isYesterday(now: Calendar, date: Calendar): Boolean {
            val yesterday = Calendar.getInstance().apply {
                timeInMillis = now.timeInMillis
                add(Calendar.DAY_OF_YEAR, -1)
            }
            return isSameDay(yesterday, date)
        }
    }

    fun dispose() {
        scope.cancel()
    }
}
