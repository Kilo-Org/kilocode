package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListDeleteOptions
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRowHeight
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener

class WorktreeSessionEditorPanel(
    parent: Disposable,
    private val manager: WorktreeSessionEditorManager,
    private val controller: WorktreeSessionListController,
    private val worktree: ai.kilocode.client.app.Workspace,
    private val confirm: ((RelativePoint, ActiveListDeleteOptions, () -> Unit) -> Unit)? = null,
) : BorderLayoutPanel(), Disposable, UiDataProvider {
    private val add = NewAction()
    private val delete = DeleteAction()
    private val list = ActiveList(
        KiloBundle.message("worktree.session.list.empty"),
        cfg = ActiveListConfig(
            ActiveListRowHeight.EQUAL,
            description = false,
            selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
        ),
        showSearch = false,
        onCell = { key, id -> if (id == DELETE_CELL) confirmDelete(listOf(key), DELETE_CELL) },
        onOpen = { row, focus -> open(row, focus) },
        onSelect = { updateActions() },
    )
    private var started = false

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
        val left = BorderLayoutPanel()
        left.addToTop(toolbar())
        left.addToCenter(list)
        val splitter = OnePixelSplitter(false, 0.25f)
        splitter.firstComponent = left
        splitter.secondComponent = manager.component
        addToCenter(splitter)
        bindModel()
        bindTheme()
        manager.onPresent = { key -> select(key) }
        manager.onListChanged = { sync() }
        addHierarchyListener {
            if (isShowing) start()
        }
        sync()
        updateActions()
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = manager.preferredFocus() ?: list

    @RequiresEdt
    fun selectSessions(keys: List<String>) {
        if (keys.isEmpty()) return
        val view = UIUtil.findComponentOfType(list, com.intellij.ui.components.JBList::class.java) ?: return
        val indexes = keys.mapNotNull { key ->
            (0 until view.model.size).firstOrNull { idx -> (view.model.getElementAt(idx) as? ActiveListItem)?.key == key }
        }
        view.selectedIndices = indexes.toIntArray()
    }

    @RequiresEdt
    fun deleteSelected() {
        confirmDelete(selectedKeys())
    }

    @RequiresEdt
    private fun confirmDelete(ids: List<String>, cell: String? = null) {
        val active = ids.filter { it != SessionHost.NEW && it !in manager.deleting() }.distinct()
        if (active.isEmpty()) return
        val msg = if (active.size == 1) {
            KiloBundle.message("worktree.session.delete.confirm.message", title(active[0]))
        } else {
            KiloBundle.message("worktree.session.delete.confirm.message.multiple", active.size)
        }
        val opts = ActiveListDeleteOptions(
            message = msg,
            detail = KiloBundle.message("worktree.session.delete.confirm.detail"),
        )
        val handler = confirm ?: { anchor: RelativePoint, options: ActiveListDeleteOptions, run: () -> Unit ->
            list.confirmDelete(anchor, options) { run() }
        }
        handler(list.point(active[0], cell), opts) { manager.deleteSessions(active) }
    }

    @RequiresEdt
    private fun start() {
        if (started) return
        started = true
        manager.start()
    }

    @RequiresEdt
    private fun toolbar(): JComponent {
        val toolbar = ActionManager.getInstance().createActionToolbar(
            ActionPlaces.TOOLBAR,
            DefaultActionGroup(add, delete),
            true,
        )
        toolbar.targetComponent = this
        toolbar.updateActionsImmediately()
        return toolbar.component
    }

    @RequiresEdt
    private fun open(row: ActiveListItem, focus: Boolean) {
        if (row.key == SessionHost.NEW) {
            manager.newSession()
            return
        }
        val item = item(row.key) ?: return
        manager.openSession(SessionRef.Local(item), focus)
    }

    @RequiresEdt
    private fun sync() {
        val rows = mutableListOf<ActiveListItem>()
        val key = manager.currentKey()
        val pending = manager.hasPendingNew()
        val kinds = manager.activity()
        val deleting = manager.deleting()
        if (pending || key == SessionHost.NEW) rows += NewRow
        rows += HistoryTime.sorted((0 until controller.model.size).map { LocalHistoryItem(controller.model.getElementAt(it)) })
            .map { SessionRow(it.session, kinds[it.id], deleting = it.id in deleting) }
        list.update(rows, ActiveListSelection.PreserveNoScroll)
        select(if (pending) SessionHost.NEW else key)
        updateActions()
    }

    @RequiresEdt
    private fun select(key: String?) {
        if (key == null) return
        list.select(key)
    }

    @RequiresEdt
    private fun item(key: String): SessionDto? {
        return (0 until controller.model.size)
            .map { controller.model.getElementAt(it) }
            .firstOrNull { it.id == key }
    }

    @RequiresEdt
    private fun title(key: String): String {
        return item(key)?.title?.takeIf { it.isNotBlank() } ?: KiloBundle.message("worktree.session.untitled")
    }

    @RequiresEdt
    private fun selectedKeys(): List<String> = list.selectedKeys().filter { it != SessionHost.NEW && it !in manager.deleting() }

    @RequiresEdt
    private fun updateActions() {
    }

    private fun bindModel() {
        val listener = object : ListDataListener {
            override fun intervalAdded(e: ListDataEvent) = sync()

            override fun intervalRemoved(e: ListDataEvent) = sync()

            override fun contentsChanged(e: ListDataEvent) = sync()
        }
        controller.model.addListDataListener(listener)
        Disposer.register(this) { controller.model.removeListDataListener(listener) }
    }

    private fun bindTheme() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                SwingUtilities.updateComponentTreeUI(this)
            }
        })
    }

    override fun uiDataSnapshot(sink: DataSink) {
        sink[SessionManager.KEY] = manager
        sink[SessionManager.WORKSPACE_KEY] = worktree
    }

    override fun dispose() {}

    private inner class NewAction : AnAction(
        KiloBundle.message("worktree.session.new.action"),
        null,
        AllIcons.General.Add,
    ) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) {
            manager.newSession()
        }
    }

    private inner class DeleteAction : AnAction(
        KiloBundle.message("worktree.session.delete.action"),
        null,
        AllIcons.Actions.GC,
    ) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = selectedKeys().isNotEmpty()
        }

        override fun actionPerformed(e: AnActionEvent) {
            deleteSelected()
        }
    }

    private object NewRow : ActiveListItem {
        override val key: String get() = SessionHost.NEW
        override val title: String get() = KiloBundle.message("worktree.session.new")
        // Group the pending session under Today so it appears inside the list right away instead of
        // as a detached row pinned above the first section header.
        override val section: String get() = HistoryTime.title(HistorySection.TODAY)
    }

    private inner class SessionRow(
        val session: SessionDto,
        val kind: SessionActivityKind?,
        override val deleting: Boolean = false,
    ) : ActiveListItem {
        private val item = LocalHistoryItem(session)
        override val key: String get() = session.id
        override val title: String get() = session.title.takeIf { it.isNotBlank() }
            ?: KiloBundle.message("worktree.session.untitled")
        override val tooltip: String get() = title
        override val badges: List<ActiveListBadge> get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })
        override val section: String get() = HistoryTime.title(HistoryTime.section(item))
        override val search: String get() = listOf(session.title, session.id, session.directory).joinToString(" ")
        override val cells: List<ActiveListCell>
            get() {
                if (selectedKeys().size != 1) return emptyList()
                return listOf(ActiveListCell(
                    DELETE_CELL,
                    KiloBundle.message("worktree.session.delete.action"),
                    icon = AllIcons.Actions.GC,
                    iconOnly = true,
                ))
            }
    }

    private companion object {
        const val DELETE_CELL = "delete"
    }
}
