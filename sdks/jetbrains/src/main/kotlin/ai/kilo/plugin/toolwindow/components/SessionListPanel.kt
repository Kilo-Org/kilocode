package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.Session
import ai.kilo.plugin.model.SessionStatus
import ai.kilo.plugin.services.KiloStateService
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloSizes
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
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
import java.text.SimpleDateFormat
import java.util.*
import javax.swing.*

/**
 * Panel displaying the list of chat sessions.
 *
 * @param onSessionSelected Callback invoked when a session is selected (to switch back to chat view)
 */
class SessionListPanel(
    private val project: Project,
    private val stateService: KiloStateService,
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
                        stateService.selectSession(selected.id)
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
    }

    private fun createContextMenu(): JPopupMenu {
        return JPopupMenu().apply {
            add(JMenuItem("Rename").apply {
                addActionListener {
                    val selected = sessionList.selectedValue ?: return@addActionListener
                    renameSession(selected)
                }
            })
            add(JMenuItem("Archive").apply {
                addActionListener {
                    val selected = sessionList.selectedValue ?: return@addActionListener
                    archiveSession(selected)
                }
            })
            addSeparator()
            add(JMenuItem("Delete").apply {
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
                stateService.renameSession(session.id, newTitle)
            }
        }
    }

    private fun archiveSession(session: Session) {
        val confirm = JOptionPane.showConfirmDialog(
            this,
            "Archive session '${session.title}'?",
            "Archive Session",
            JOptionPane.YES_NO_OPTION
        )

        if (confirm == JOptionPane.YES_OPTION) {
            scope.launch {
                stateService.archiveSession(session.id)
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
                stateService.deleteSession(session.id)
            }
        }
    }

    private fun subscribeToState() {
        // Subscribe to sessions and statuses
        scope.launch {
            combine(
                stateService.sessions,
                stateService.sessionStatuses
            ) { sessions, statuses ->
                Pair(sessions, statuses)
            }.collectLatest { (sessions, statuses) ->
                sessionStatuses = statuses
                updateSessionList(sessions)
            }
        }

        // Subscribe to current session selection
        scope.launch {
            stateService.currentSessionId.collectLatest { sessionId ->
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

    private inner class SessionCellRenderer : ColoredListCellRenderer<Session>() {
        private val dateFormat = SimpleDateFormat("MMM d, HH:mm")
        
        private val titleAttrs = SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, KiloTheme.textStrong)
        private val dateAttrs = SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, KiloTheme.textWeak)
        private val busyAttrs = SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, KiloTheme.iconInteractive)

        init {
            // Set fixed insets to prevent size changes on hover
            ipad = JBUI.insets(KiloSpacing.xs, KiloSpacing.md)
        }

        override fun customizeCellRenderer(
            list: JList<out Session>,
            value: Session,
            index: Int,
            selected: Boolean,
            hasFocus: Boolean
        ) {
            // Background styling
            background = if (selected) KiloTheme.surfaceInteractive else KiloTheme.backgroundStronger
            
            // Status icon
            val status = sessionStatuses[value.id]
            icon = when (status?.type) {
                "busy" -> AllIcons.Process.Step_1
                "retry" -> AllIcons.General.Warning
                else -> AllIcons.General.Balloon
            }

            // Title - use theme colors
            append(value.title.ifBlank { "Untitled" }, if (selected) SimpleTextAttributes.REGULAR_ATTRIBUTES else titleAttrs)

            // Date
            append(
                " · ${dateFormat.format(Date(value.time.updated))}",
                dateAttrs
            )

            // Status indicator
            if (status?.type == "busy") {
                append(" ●", busyAttrs)
            }
        }
    }

    fun dispose() {
        scope.cancel()
    }
}
