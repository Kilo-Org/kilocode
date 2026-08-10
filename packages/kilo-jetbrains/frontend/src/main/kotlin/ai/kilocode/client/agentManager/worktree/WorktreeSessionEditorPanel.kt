package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.diff.diffParams
import ai.kilocode.client.diff.ensureDiffEditorKind
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.session.history.LocalHistoryItem
import ai.kilocode.client.util.bindTheme
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListDeleteOptions
import ai.kilocode.client.ui.list.ActiveListEditOptions
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMenu
import ai.kilocode.client.ui.list.ActiveListRowHeight
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListSurface
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.IdeBorderFactory
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SideBorder
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import javax.swing.JComponent
import javax.swing.ListSelectionModel
import javax.swing.JPanel
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener

class WorktreeSessionEditorPanel(
    parent: Disposable,
    private val manager: WorktreeSessionEditorManager,
    private val controller: WorktreeSessionListController,
    private val worktree: ai.kilocode.client.app.Workspace,
    private val project: Project? = null,
    private val confirm: ((RelativePoint, ActiveListDeleteOptions, () -> Unit) -> Unit)? = null,
    private val edit: ((RelativePoint, ActiveListEditOptions, (String) -> Unit) -> Unit)? = null,
) : BorderLayoutPanel(), Disposable, UiDataProvider {
    private val add = NewAction()
    private val rename = RenameAction()
    private val delete = DeleteAction()
    private val group = ActionManager.getInstance().getAction("Kilo.WorktreeSession.RowMenu") as? ActionGroup ?: DefaultActionGroup()
    private val list = ActiveList(
        KiloBundle.message("worktree.session.list.empty"),
        cfg = ActiveListConfig(
            ActiveListRowHeight.EQUAL,
            description = false,
            selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
            hoverActions = true,
        ),
        surface = ActiveListSurface.ToolWindow,
        showSearch = false,
        enter = { true },
        onCell = { _, _ -> },
        onOpen = { row, focus -> open(row, focus) },
        menu = ActiveListMenu(WorktreeSessionDataKeys.SESSION, group, element = { row ->
            (row as? SessionRow)?.session?.takeIf { canRename(it) || canDelete(it) }
        }),
    )
    private val statsView = WorktreeStatsView(::openBranchDiff)
    private var started = false
    private var stats: WorktreeStatsDto? = null
    private var pr: WorktreePrDto? = null

    init {
        Disposer.register(parent, this)
        isOpaque = true
        val left = object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeListToolWindowBackground()
        }
        left.add(toolbar(), BorderLayout.NORTH)
        left.add(list, BorderLayout.CENTER)
        list.installPopup(group)
        val splitter = OnePixelSplitter(false, 0.25f)
        splitter.firstComponent = left
        splitter.secondComponent = manager.component
        addToCenter(splitter)
        bindModel()
        manager.onPresent = { key -> select(key) }
        manager.onListChanged = {
            sync()
            project?.service<WorktreeStatusService>()?.refreshStats()
        }
        ActionManager.getInstance().getAction("RenameElement")?.shortcutSet?.let { set ->
            rename.registerCustomShortcutSet(set, list, this)
        }
        addHierarchyListener {
            if (isShowing) {
                start()
                project?.service<WorktreeStatusService>()?.refreshStats()
                project?.service<WorktreeStatusService>()?.refreshPr()
            }
        }
        bindStatus()
        bindTheme(this, this)
        sync()
    }

    override fun getBackground(): Color = activeListToolWindowBackground()

    @RequiresEdt
    fun preferredFocus(): JComponent = list.preferredFocus()

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
    fun renameSelected() {
        val key = selectedKeys().firstOrNull { it != SessionHost.NEW && it !in manager.deleting() } ?: return
        beginRename(key)
    }

    @RequiresEdt
    internal fun canDelete(item: SessionDto?): Boolean = item != null && item.id != SessionHost.NEW && item.id !in manager.deleting()

    @RequiresEdt
    internal fun canRename(item: SessionDto?): Boolean = canDelete(item)

    @RequiresEdt
    internal fun deleteRow(item: SessionDto) = confirmDelete(listOf(item.id))

    @RequiresEdt
    internal fun renameRow(item: SessionDto) = beginRename(item.id)

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
    private fun beginRename(key: String, cell: String? = null) {
        if (key == SessionHost.NEW || key in manager.deleting()) return
        val value = title(key)
        if (!list.select(key)) return
        val handler = edit ?: { anchor: RelativePoint, opts: ActiveListEditOptions, commit: (String) -> Unit ->
            list.editName(anchor, opts, commit)
        }
        handler(list.point(key, cell), ActiveListEditOptions(value)) { name ->
            manager.renameSession(key, name)
        }
    }

    @RequiresEdt
    private fun start() {
        if (started) return
        started = true
        manager.start()
        project?.service<WorktreeStatusService>()?.refreshStats()
        project?.service<WorktreeStatusService>()?.refreshPr()
    }

    @RequiresEdt
    private fun toolbar(): JComponent {
        val toolbar = ActionManager.getInstance().createActionToolbar(
            ActionPlaces.TOOLBAR,
            DefaultActionGroup(add, rename, delete),
            true,
        )
        toolbar.targetComponent = this
        toolbar.component.background = activeListToolWindowBackground()
        toolbar.updateActionsImmediately()
        return object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeListToolWindowBackground()
        }.apply {
            border = IdeBorderFactory.createBorder(SideBorder.BOTTOM)
            add(toolbar.component, BorderLayout.WEST)
            add(statsView, BorderLayout.EAST)
        }
    }

    @RequiresEdt
    private fun openBranchDiff() {
        val target = project ?: return
        ensureDiffEditorKind()
        target.service<KiloVfsManager>().open(
            KiloDiffEditorKind.ID,
            diffParams("branch", worktree.directory, null, KiloBundle.message("diff.editor.branch.title")),
        )
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
        val titles = manager.titles()
        val deleting = manager.deleting()
        if (pending || key == SessionHost.NEW) rows += NewRow
        rows += HistoryTime.sorted(controller.sessions().map { LocalHistoryItem(it) })
            .map { SessionRow(it.session, kinds[it.id], deleting = it.id in deleting, live = titles[it.id]) }
        list.update(rows, ActiveListSelection.PreserveNoScroll)
        select(if (pending) SessionHost.NEW else key)
    }

    @RequiresEdt
    private fun select(key: String?) {
        if (key == null) return
        list.select(key)
    }

    @RequiresEdt
    private fun item(key: String): SessionDto? = controller.session(key)

    @RequiresEdt
    private fun title(key: String): String {
        return item(key)?.title?.takeIf { it.isNotBlank() } ?: KiloBundle.message("worktree.session.untitled")
    }

    @RequiresEdt
    private fun selectedKeys(): List<String> = list.selectedKeys().filter { it != SessionHost.NEW && it !in manager.deleting() }

    private fun bindModel() {
        val listener = object : ListDataListener {
            override fun intervalAdded(e: ListDataEvent) = sync()

            override fun intervalRemoved(e: ListDataEvent) = sync()

            override fun contentsChanged(e: ListDataEvent) = sync()
        }
        controller.model.addListDataListener(listener)
        Disposer.register(this) { controller.model.removeListDataListener(listener) }
    }

    private fun bindStatus() {
        val target = project ?: return
        val key = normalizeWorktreePath(worktree.directory)
        WorktreeStatusBinding(
            target,
            this,
            onStats = { value -> stats = value[key]; statsView.update(stats, pr) },
            onPr = { value -> pr = value[key]; statsView.update(stats, pr) },
        )
    }

    override fun uiDataSnapshot(sink: DataSink) {
        sink[WorktreeSessionDataKeys.PANEL] = this
        selectedSession()?.let { sink[WorktreeSessionDataKeys.SESSION] = it }
        sink[SessionManager.KEY] = manager
        sink[SessionManager.WORKSPACE_KEY] = worktree
    }

    override fun dispose() {
        manager.onPresent = null
        manager.onListChanged = null
    }

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

    private inner class RenameAction : AnAction(
        KiloBundle.message("worktree.session.rename.action"),
        null,
        AllIcons.Actions.Edit,
    ) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = selectedKeys().any { it != SessionHost.NEW && it !in manager.deleting() }
        }

        override fun actionPerformed(e: AnActionEvent) {
            renameSelected()
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
        // Live title of the open session, if any; reflects the agent-generated name as it streams in
        // before the listed snapshot catches up.
        private val live: String? = null,
    ) : ActiveListItem {
        private val item = LocalHistoryItem(session)
        override val key: String get() = session.id
        override val title: String get() {
            val name = live?.takeIf { it.isNotBlank() } ?: session.title
            if (name.isBlank()) return KiloBundle.message("worktree.session.untitled")
            // Show the placeholder as a friendly "New session" until the agent names the session.
            if (isDefaultSessionTitle(name)) return KiloBundle.message("worktree.session.new")
            return name
        }
        override val tooltip: String get() = title
        override val badges: List<ActiveListBadge> get() = listOfNotNull(kind?.let(::worktreeActivityBadge))
        override val section: String get() = HistoryTime.title(HistoryTime.section(item))
        override val search: String get() = listOf(session.title, session.id, session.directory).joinToString(" ")
    }

    @RequiresEdt
    private fun selectedSession(): SessionDto? {
        return list.selectedItems().filterIsInstance<SessionRow>().firstOrNull()?.session
    }
}
