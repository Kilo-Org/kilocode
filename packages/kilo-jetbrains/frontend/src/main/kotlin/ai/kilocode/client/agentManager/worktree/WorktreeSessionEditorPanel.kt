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
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.telemetry.Telemetry
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
import ai.kilocode.client.ui.list.ActiveListWeight
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ActivityTracker
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
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.WindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import com.intellij.ui.IdeBorderFactory
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SideBorder
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import org.jetbrains.plugins.terminal.TerminalToolWindowFactory
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Frame
import javax.swing.JComponent
import javax.swing.Icon
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
    private val openWorktree: ((String) -> Unit)? = null,
) : BorderLayoutPanel(), Disposable, UiDataProvider {
    private val add = NewAction()
    private val rename = RenameAction()
    private val delete = DeleteAction()
    private val toggle = ToggleAction()
    private val toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, DefaultActionGroup(toggle, add, rename, delete), true)
    private val group = ActionManager.getInstance().getAction("Kilo.WorktreeSession.RowMenu") as? ActionGroup ?: DefaultActionGroup()
    private val list = ActiveList(
        KiloBundle.message("worktree.session.list.empty"),
        cfg = ActiveListConfig(
            ActiveListRowHeight.EQUAL,
            description = false,
            selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
            hoverActions = true,
            title = ActiveListWeight.PLAIN,
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
    private val prHeader = WorktreePrHeaderView(openWorktree = ::openInNewFrame, openEnabled = worktree.directory.isNotBlank(), openDiff = ::openBranchDiff, openTerminal = ::openTerminal)
    private val splitter = OnePixelSplitter(false, 0.25f)
    private var started = false
    private var stats: WorktreeStatsDto? = null
    private var pr: WorktreePrDto? = null

    init {
        Disposer.register(parent, this)
        isOpaque = true
        toolbar.targetComponent = this
        // Keep the toolbar transparent so it shows its themed parent background and tracks
        // Look-and-Feel changes automatically, instead of caching a color that goes stale.
        toolbar.component.isOpaque = false
        syncToolbar()
        list.installPopup(group)
        splitter.firstComponent = list
        splitter.secondComponent = manager.component
        addToTop(top())
        addToCenter(splitter)
        syncExpanded(KiloPluginSettings.getWorktreeSessionListExpanded())
        bindModel()
        manager.onPresent = { key -> key?.let { list.select(it) } }
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
        sync()
    }

    override fun getBackground(): Color = activeListToolWindowBackground()

    @RequiresEdt
    fun preferredFocus(): JComponent = if (expanded()) list.preferredFocus() else manager.component

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
    private fun header(): JComponent {
        return object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeListToolWindowBackground()
        }.apply {
            border = IdeBorderFactory.createBorder(SideBorder.BOTTOM)
            add(toolbarPanel(), BorderLayout.WEST)
            add(prHeader, BorderLayout.CENTER)
        }
    }

    @RequiresEdt
    private fun top(): JComponent {
        val target = project ?: return header()
        return Stack.vertical()
            .next(GhBanner(target, this))
            .next(header())
    }

    @RequiresEdt
    private fun toolbarPanel(): JComponent {
        return object : JPanel(BorderLayout()) {
            override fun getBackground(): Color = activeListToolWindowBackground()
        }.apply {
            border = IdeBorderFactory.createBorder(SideBorder.RIGHT)
            add(toolbar.component, BorderLayout.CENTER)
        }
    }

    @RequiresEdt
    private fun toggleExpanded() {
        syncExpanded(!expanded())
        KiloPluginSettings.setWorktreeSessionListExpanded(expanded())
    }

    @RequiresEdt
    private fun expanded(): Boolean = splitter.firstComponent != null

    @RequiresEdt
    private fun syncToolbar() {
        // Tests need a synchronous refresh to assert action presentations; production nudges the
        // platform's action-update pass instead of the deprecated blocking updateActionsImmediately().
        if (ApplicationManager.getApplication().isUnitTestMode) {
            @Suppress("DEPRECATION")
            toolbar.updateActionsImmediately()
            return
        }
        ActivityTracker.getInstance().inc()
    }

    @RequiresEdt
    private fun syncExpanded(value: Boolean) {
        val changed = expanded() != value
        if (changed) splitter.firstComponent = if (value) list else null
        syncToolbar()
        if (!changed) return
        splitter.revalidate()
        splitter.repaint()
    }

    @RequiresEdt
    private fun openInNewFrame() {
        val dir = worktree.directory.takeIf { it.isNotBlank() } ?: return
        LOG.info("worktree open: clicked dir=$dir seam=${openWorktree != null}")
        Telemetry.send("Worktree Opened In New Frame", mapOf("surface" to "worktree_toolbar"))
        if (openWorktree != null) {
            openWorktree.invoke(dir)
            return
        }
        if (focusExistingFrame(dir)) return
        LOG.info("worktree open: no local frame matched, delegating to backend dir=$dir")
        service<KiloWorktreeService>().openInBackground(dir)
    }

    /**
     * Focus runs in the frontend client because it owns the visible windows in remote development.
     * Match on presentableUrl, the same project identity the platform Window menu uses (see
     * com.intellij.openapi.wm.impl.ProjectWindowAction), and never ask the backend to reopen once the
     * worktree is already open.
     */
    @RequiresEdt
    private fun focusExistingFrame(dir: String): Boolean {
        val projects = ProjectManager.getInstance().openProjects
        LOG.info(
            "worktree focus: target=$dir among ${projects.size} open project(s): " +
                projects.joinToString { "[name=${it.name} presentableUrl=${it.presentableUrl} basePath=${it.basePath} default=${it.isDefault}]" },
        )
        val item = projects.firstOrNull { same(it.presentableUrl, dir) || same(it.basePath, dir) }
        if (item == null) {
            LOG.info("worktree focus: no open project matched target=$dir")
            return false
        }
        val frame = WindowManager.getInstance().getFrame(item)
        if (frame == null) {
            LOG.info("worktree focus: matched project=${item.name} but it has no frame yet")
            return true
        }
        val state = frame.extendedState
        if (state and Frame.ICONIFIED != 0) frame.extendedState = state and Frame.ICONIFIED.inv()
        frame.toFront()
        val focus = IdeFocusManager.getGlobalInstance()
        focus.doWhenFocusSettlesDown { frame.mostRecentFocusOwner?.let { focus.requestFocus(it, true) } }
        LOG.info("worktree focus: brought frame to front for project=${item.name}")
        return true
    }

    private fun same(path: String?, dir: String): Boolean = FileUtil.pathsEqual(path, dir)

    @RequiresEdt
    private fun openBranchDiff() {
        val target = project ?: return
        ensureDiffEditorKind()
        target.service<KiloVfsManager>().open(
            KiloDiffEditorKind.ID,
            diffParams("branch", worktree.directory, null, KiloBundle.message("diff.editor.branch.title")),
        )
    }

    /**
     * Opens (or focuses) the worktree's terminal tab in the host IDE's terminal tool window. Tabs are
     * tagged with the worktree directory via user data on the tab's [Content], so re-clicking reuses
     * the existing tab instead of spawning a new shell -- this survives the user cd-ing or renaming the
     * tab, unlike matching by working directory or tab name.
     */
    @RequiresEdt
    private fun openTerminal() {
        val dir = worktree.directory.takeIf { it.isNotBlank() } ?: return
        val target = project ?: return
        Telemetry.send("Worktree Terminal Opened", mapOf("surface" to "worktree_toolbar"))
        val tabs = TerminalToolWindowTabsManager.getInstance(target)
        val existing = tabs.tabs.firstOrNull { same(it.content.getUserData(TERMINAL_DIR), dir) }
        if (existing != null) {
            existing.content.manager?.setSelectedContent(existing.content, true)
            ToolWindowManager.getInstance(target).getToolWindow(TerminalToolWindowFactory.TOOL_WINDOW_ID)?.activate(null)
            return
        }
        val name = terminalName()
        val tab = tabs.createTabBuilder()
            .workingDirectory(dir)
            .tabName(name)
            .requestFocus(true)
            .createTab()
        tab.content.putUserData(TERMINAL_DIR, dir)
        // Pin the worktree label as the user-defined title so the shell's cwd/command title can't
        // overwrite it, matching the worktree list and editor tab.
        tab.view.title.change { userDefinedTitle = name }
    }

    /** The worktree label shared with the list and editor tab (PR title, else name, else path). */
    @RequiresEdt
    private fun terminalName(): String = service<WorktreeNameCache>().title(worktree.directory)

    /** Retitles the worktree's terminal tab, if one is open, when its name or PR changes. */
    @RequiresEdt
    private fun syncTerminalName() {
        val dir = worktree.directory.takeIf { it.isNotBlank() } ?: return
        val target = project ?: return
        val tab = TerminalToolWindowTabsManager.getInstance(target)
            .tabs.firstOrNull { same(it.content.getUserData(TERMINAL_DIR), dir) } ?: return
        tab.view.title.change { userDefinedTitle = terminalName() }
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
        // The host owns which session is shown, so it also owns the selection: name the row and let
        // the list hold that key until a refresh brings it in.
        val shown = if (pending) SessionHost.NEW else key
        list.update(rows, shown?.let { ActiveListSelection.Key(it) } ?: ActiveListSelection.Preserve)
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
        val key = normalizeWorktreePath(worktree.directory)
        syncHeader()
        service<WorktreeNameCache>().addListener(this) { path, _ ->
            if (normalizeWorktreePath(path) == key) {
                syncHeader()
                syncTerminalName()
            }
        }
        val target = project ?: return
        WorktreeStatusBinding(
            target,
            this,
            onStats = { value -> stats = value[key]; syncHeader() },
            onPr = { value -> pr = value[key]; syncHeader() },
        )
    }

    @RequiresEdt
    private fun syncHeader() {
        prHeader.update(stats, pr, worktreeName())
    }

    @RequiresEdt
    private fun worktreeName(): String {
        val key = normalizeWorktreePath(worktree.directory)
        return service<WorktreeNameCache>().get(worktree.directory)
            ?: service<WorktreeNameCache>().get(key)
            ?: key.trimEnd('/').substringAfterLast('/').ifBlank { key }
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

    private inner class ToggleAction : AnAction() {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            val expanded = expanded()
            e.presentation.text = KiloBundle.message(if (expanded) "worktree.session.list.collapse" else "worktree.session.list.expand")
            e.presentation.icon = if (expanded) LAYOUT_FULL else LAYOUT_PARTIAL
        }

        override fun actionPerformed(e: AnActionEvent) {
            toggleExpanded()
        }
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
            e.presentation.isVisible = expanded()
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
            e.presentation.isVisible = expanded()
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

    private companion object {
        private val LOG = KiloLog.create(WorktreeSessionEditorPanel::class.java)
        private val TERMINAL_DIR = Key.create<String>("kilo.worktree.terminal.dir")
        val LAYOUT_PARTIAL: Icon = IconLoader.getIcon("/icons/layout-left-partial.svg", WorktreeSessionEditorPanel::class.java)
        val LAYOUT_FULL: Icon = IconLoader.getIcon("/icons/layout-left-full.svg", WorktreeSessionEditorPanel::class.java)
    }

    private inner class SessionRow(
        val session: SessionDto,
        val kind: SessionActivityKind?,
        private val deleting: Boolean = false,
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
        override val progress: String? get() = if (deleting) KiloBundle.message("common.deleting") else null
        override val badges: List<ActiveListBadge>
            get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })
        override val section: String get() = HistoryTime.title(HistoryTime.section(item))
        override val search: String get() = listOf(session.title, session.id, session.directory).joinToString(" ")
    }

    @RequiresEdt
    private fun selectedSession(): SessionDto? {
        return list.selectedItems().filterIsInstance<SessionRow>().firstOrNull()?.session
    }
}
