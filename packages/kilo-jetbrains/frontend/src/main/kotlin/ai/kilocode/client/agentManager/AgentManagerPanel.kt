package ai.kilocode.client.agentManager

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.worktree.CreateFailure
import ai.kilocode.client.agentManager.worktree.CreateKind
import ai.kilocode.client.agentManager.worktree.NewWorktreeDialog
import ai.kilocode.client.agentManager.worktree.NewWorktreeHandle
import ai.kilocode.client.agentManager.worktree.NewWorktreePlan
import ai.kilocode.client.agentManager.worktree.GhBanner
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.WorktreeStatusBinding
import ai.kilocode.client.agentManager.worktree.WorktreeStatusService
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.WorktreeTitle
import ai.kilocode.client.agentManager.worktree.openWorktreeSession
import ai.kilocode.client.agentManager.worktree.normalizeWorktreePath
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.ui.prTooltip
import ai.kilocode.client.ui.style
import ai.kilocode.client.diff.KiloDiffEditorKind
import ai.kilocode.client.diff.diffParams
import ai.kilocode.client.diff.ensureDiffEditorKind
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListDeleteOptions
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListMenu
import ai.kilocode.client.ui.list.ActiveListMetrics
import ai.kilocode.client.ui.list.ActiveListReorder
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListSurface
import ai.kilocode.client.ui.list.ActiveListWeight
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.ide.DeleteProvider
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Component
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener
import javax.swing.JComponent

/**
 * Agent Manager panel: a git-worktree list with search and a delete action revealed on selection,
 * plus a create prompt driven from the tool-window action.
 */
class AgentManagerPanel(
    parent: Disposable,
    private val controller: WorktreeController,
    private val project: Project? = null,
    private val dialog: (Component, Project) -> NewWorktreeHandle = { anchor, target ->
        NewWorktreeDialog(
            anchor,
            target,
            controller.directory,
            controller.suggestName(),
            controller.defaultBranch,
            controller.branches,
        )
    },
) : BorderLayoutPanel(), Disposable, UiDataProvider {
    private val provider = WorktreeDeleteProvider()
    private val edit = RenameAction()
    private val group = ActionManager.getInstance().getAction("Kilo.Worktree.RowMenu") as? ActionGroup ?: DefaultActionGroup()
    private val list = ActiveList(
        KiloBundle.message("worktree.empty"),
        cfg = ActiveListConfig(
            hoverActions = true,
            title = ActiveListWeight.PLAIN,
            header = ActiveListWeight.PLAIN,
        ),
        surface = ActiveListSurface.ToolWindow,
        showSearch = false,
        onCell = { _, _ -> },
        onOpen = { row, focus ->
            val item = (row as? WorktreeRow)?.dto ?: return@ActiveList
            open(item, focus)
        },
        menu = ActiveListMenu(WorktreeDataKeys.WORKTREE, group, element = { row ->
            (row as? WorktreeRow)?.dto?.takeIf { canRename(it) || canDelete(it) || canOpenPr(it) || canOpenDiff(it) }
        }),
        reorder = ActiveListReorder(
            movable = { row -> row is WorktreeRow && !row.current && row.progress == null },
            onMove = { move -> controller.reorder(move.keys) },
        ),
    )
    private var stats: Map<String, WorktreeStatsDto> = emptyMap()
    private var prs: Map<String, WorktreePrDto> = emptyMap()

    init {
        Disposer.register(parent, this)
        isOpaque = true
        project?.let { addToTop(GhBanner(it, this)) }
        addToCenter(body())
        list.installPopup(group)
        sync()
        bindModel()
        controller.onSelect = { key ->
            // Focus the list so the freshly created worktree renders as an active selection rather
            // than the inactive highlight it would get while focus stays on the toolbar.
            if (list.select(key)) list.focusList()
            item(key)?.takeIf { controller.progress(it.id) == null }?.let { open(it, focus = false) }
        }
        // A fresh worktree changes what git reports, so bypass the refresh throttle instead of
        // leaving the new row without its stats and PR badge until the next poll.
        controller.onCreated = {
            project?.service<WorktreeStatusService>()?.refreshStats()
            project?.service<WorktreeStatusService>()?.refreshPr(force = true)
        }
        controller.onReload = { sync() }
        controller.onCreateFailure = { err -> notifyCreateFailed(err) }
        controller.onMoveFailure = { err -> notifyMoveFailed(err) }
        controller.onRemoveSuccess = { item, index -> onRemoved(item, index) }
        controller.onActivityChanged = {
            sync()
            project?.service<WorktreeStatusService>()?.refreshStats()
        }
        bindStatus()
        bindEditorSelection()
        // Reflect names adopted or renamed in a worktree session editor tab in the list live.
        service<WorktreeNameCache>().addListener(this) { path, name ->
            controller.applyName(path, name)
            project?.service<KiloVfsManager>()?.updatePresentation(WorktreeSessionEditorKind.ID, mapOf("path" to path))
        }
        ActionManager.getInstance().getAction("RenameElement")?.shortcutSet?.let { set ->
            edit.registerCustomShortcutSet(set, list, this)
        }
    }

    val component: JComponent get() = this

    override fun getBackground(): Color = activeListToolWindowBackground()

    private fun body(): JComponent {
        return object : BorderLayoutPanel() {
            override fun getBackground(): Color = activeListToolWindowBackground()
        }.apply {
            border = JBUI.Borders.empty(UiStyle.Gap.sm())
            addToCenter(list)
        }
    }

    fun refresh() {
        if (list.selectedKeys().isEmpty()) currentEditorWorktree()?.let { list.select(it, scroll = false) }
        controller.reload()
        project?.service<WorktreeStatusService>()?.refreshStats()
        project?.service<WorktreeStatusService>()?.refreshPr()
    }

    /**
     * Opens the New Worktree dialog anchored at [anchor]. The worktree is created only after the
     * dialog closes, so [onCreate] — e.g. the chat dock switching the tool window to this panel —
     * never competes with the modal dialog for focus.
     */
    fun configure(anchor: Component = this, onCreate: () -> Unit = {}) {
        val target = project ?: return
        val handle = dialog(anchor, target)
        if (!handle.showAndGet()) return
        val plan = handle.result() ?: return
        onCreate()
        when (plan) {
            is NewWorktreePlan.Create -> controller.create(plan.branch, plan.base, prompt = plan.prompt)
            is NewWorktreePlan.Branch -> {
                Telemetry.send("Worktree Import Submitted", mapOf("kind" to "branch"))
                controller.importBranch(plan.branch)
            }
            is NewWorktreePlan.Pr -> {
                Telemetry.send("Worktree Import Submitted", mapOf("kind" to "pr"))
                controller.importPr(plan.url)
            }
        }
    }

    internal fun move(sessionId: String?, directory: String) = controller.move(sessionId, directory)

    private fun remove(item: WorktreeDto, force: Boolean) {
        controller.remove(item, force, onFailure = { result -> notifyFailed(item, result, force) })
    }

    internal fun rename(item: WorktreeDto) = beginRename(item)

    internal fun canRename(item: WorktreeDto?): Boolean = renameable(item)

    internal fun canShowRename(item: WorktreeDto?): Boolean = renameVisible(item)

    private fun beginRename(item: WorktreeDto, cell: String? = null) {
        list.rename(
            item.id,
            cell,
            current = { key -> item(key)?.takeIf(::renameable)?.name },
            commit = { key, name -> item(key)?.takeIf(::renameable)?.let { renameWorktree(it, name) } },
        )
    }

    private fun renameWorktree(item: WorktreeDto, name: String) {
        controller.rename(
            item,
            name,
            onSuccess = { updated ->
                project?.service<KiloVfsManager>()?.updatePresentation(WorktreeSessionEditorKind.ID, worktreeSessionParams(updated))
            },
            onFailure = { err ->
                KiloNotifications.error(project, KiloBundle.message("worktree.rename.failed.title", name), err)
            },
        )
    }

    private fun open(item: WorktreeDto, focus: Boolean) {
        val target = project ?: return
        if (controller.progress(item.id) != null) return
        openWorktreeSession(target, item, focus)
    }

    private fun close(item: WorktreeDto) {
        val target = project ?: return
        target.service<KiloVfsManager>().close(WorktreeSessionEditorKind.ID, worktreeSessionParams(item))
    }

    internal fun delete(item: WorktreeDto) = showDeletePopup(item)

    internal fun canDelete(item: WorktreeDto?): Boolean = deletable(item)

    internal fun canOpenPr(item: WorktreeDto?): Boolean = prUrl(item) != null

    internal fun openPr(item: WorktreeDto) = prUrl(item)?.let { BrowserUtil.browse(it) }

    /** The PR URL for [item], or null when it has none or is not in a stable, openable state. */
    private fun prUrl(item: WorktreeDto?): String? {
        if (item == null) return null
        if (controller.progress(item.id) != null) return null
        return prs[normalizeWorktreePath(item.path)]?.url
    }

    internal fun canOpenDiff(item: WorktreeDto?): Boolean {
        if (item == null || item.main || project == null) return false
        return controller.progress(item.id) == null
    }

    internal fun openDiff(item: WorktreeDto) {
        if (canOpenDiff(item)) openBranchDiff(item.path)
    }

    private fun showDeletePopup(item: WorktreeDto, cell: String? = null) {
        val opts = ActiveListDeleteOptions(
            message = KiloBundle.message("worktree.delete.confirm.message", item.name),
            detail = KiloBundle.message("worktree.delete.confirm.detail"),
            gate = if (item.locked) KiloBundle.message("worktree.delete.locked.confirm") else null,
        )
        list.confirmDelete(list.point(item.id, cell), opts) { force ->
            controller.remove(
                item,
                force,
                onFailure = { result -> notifyFailed(item, result, force) },
            )
        }
    }

    private fun deletable(item: WorktreeDto?): Boolean {
        return worktreeDeletable(item, item?.id?.let(controller::progress) != null)
    }

    private fun renameable(item: WorktreeDto?): Boolean {
        if (!renameVisible(item)) return false
        return prUrl(item) == null
    }

    private fun renameVisible(item: WorktreeDto?): Boolean {
        if (item == null || item.main) return false
        return controller.progress(item.id) == null
    }

    /**
     * Reacts to a confirmed deletion. When the removed worktree is the one on screen, advances the
     * selection to the row that slid into its slot ([index] now points at the following row, or the
     * last row when the removed row was last) and opens it before closing the deleted tab so the
     * neighbour becomes the active editor. Deleting a background row leaves the selection untouched.
     *
     * The active editor is read before close(item) as the ground-truth "shown" signal.
     */
    private fun onRemoved(item: WorktreeDto, index: Int) {
        if (currentEditorWorktree() == item.id) advance(neighbor(index))
        close(item)
    }

    /**
     * Moves the selection to [next] after the shown worktree was deleted, opening it before the
     * deleted tab closes so it becomes the active editor. Clears the selection when nothing
     * remains. Opening first stops the closing tab's incidental editor activation from dragging
     * the selection somewhere unpredictable.
     */
    private fun advance(next: WorktreeDto?) {
        if (next == null) {
            list.clearSelection()
            return
        }
        if (list.select(next.id)) list.focusList()
        open(next, focus = false)
    }

    /**
     * The row that slides into [index] after a removal: the following worktree, or the last row
     * when the removed row was last. Null when the list is now empty.
     */
    private fun neighbor(index: Int): WorktreeDto? {
        val size = controller.model.size
        if (size == 0) return null
        return controller.model.getElementAt(index.coerceIn(0, size - 1))
    }

    private fun notifyCreateFailed(failure: CreateFailure) {
        val title = when (failure.kind) {
            CreateKind.CREATE -> KiloBundle.message("worktree.create.failed.title")
            CreateKind.BRANCH -> KiloBundle.message("worktree.import.branch.failed.title", failure.branch)
            CreateKind.PR -> KiloBundle.message("worktree.import.pr.failed.title")
        }
        KiloNotifications.error(project, title, failure.error)
    }

    private fun notifyMoveFailed(err: String?) {
        KiloNotifications.error(project, KiloBundle.message("worktree.move.failed.title"), err)
    }

    /** Surfaces a failed removal; offers a force-delete retry when git reported a lock. */
    private fun notifyFailed(item: WorktreeDto, result: RemoveWorktreeResultDto, forced: Boolean) {
        val title = KiloBundle.message("worktree.delete.failed.title", item.name)
        if (result.locked && !forced) {
            KiloNotifications.error(
                project,
                title,
                result.error,
                KiloBundle.message("worktree.delete.force"),
            ) { remove(item, force = true) }
            return
        }
        KiloNotifications.error(project, title, result.error)
    }

    private fun bindEditorSelection() {
        val target = project ?: return
        target.service<WorktreeEditorMatchers>().register(WorktreeSessionEditorMatcher)
        val bus = target.messageBus.connect(this)
        bus.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, object : FileEditorManagerListener {
            override fun selectionChanged(event: FileEditorManagerEvent) = track(event.newFile)
        })
        track(FileEditorManager.getInstance(target).selectedFiles.firstOrNull())
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

    private fun sync() {
        val current = controller.current?.let { item ->
            WorktreeRow(
                item,
                progress = null,
                kind = controller.kind(item.path),
                stats = null,
                // The main checkout can sit on a PR branch just like a worktree can.
                pr = prs[normalizeWorktreePath(item.path)],
                current = true,
            )
        }
        list.update(
            listOfNotNull(current) + (0 until controller.model.size).map {
                val item = controller.model.getElementAt(it)
                val key = normalizeWorktreePath(item.path)
                val pull = prs[key]
                service<WorktreeNameCache>().putPr(item.path, pull)
                WorktreeRow(
                    item,
                    controller.progress(item.id),
                    controller.kind(item.path),
                    stats[key],
                    pull,
                )
            },
            ActiveListSelection.Preserve,
        )
    }

    @RequiresEdt
    private fun track(file: VirtualFile?) {
        val key = project?.service<WorktreeEditorMatchers>()?.match(file)
        if (key != null) {
            list.select(key, scroll = false)
            return
        }
        // A null active editor is a transient state (e.g. a tab closing during a delete); keep the
        // current selection. Only a real, non-worktree editor clears the worktree row selection.
        if (file == null) return
        list.clearSelection()
    }

    @RequiresEdt
    private fun currentEditorWorktree(): String? {
        val target = project ?: return null
        val file = FileEditorManager.getInstance(target).selectedFiles.firstOrNull()
        return target.service<WorktreeEditorMatchers>().match(file)
    }

    private fun item(key: String): WorktreeDto? {
        return (0 until controller.model.size)
            .map { controller.model.getElementAt(it) }
            .firstOrNull { it.id == key }
    }

    private fun bindStatus() {
        val target = project ?: return
        WorktreeStatusBinding(
            target,
            this,
            onStats = { value -> stats = value; sync() },
            onPr = { value -> prs = value; sync() },
        )
    }

    override fun dispose() {
        controller.onSelect = null
        controller.onCreated = null
        controller.onReload = null
        controller.onCreateFailure = null
        controller.onMoveFailure = null
        controller.onRemoveSuccess = null
        controller.onActivityChanged = null
    }

    override fun uiDataSnapshot(sink: DataSink) {
        sink[SidePanelKeys.WORKTREE_PANEL] = this
        selectedRow()?.dto?.let { sink[WorktreeDataKeys.WORKTREE] = it }
        sink[PlatformDataKeys.DELETE_ELEMENT_PROVIDER] = provider
    }

    private fun selectedRow(): WorktreeRow? = list.selected() as? WorktreeRow

    private inner class WorktreeDeleteProvider : DeleteProvider {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun canDeleteElement(dataContext: DataContext): Boolean {
            val row = selectedRow()
            return deletable(row?.dto)
        }

        override fun deleteElement(dataContext: DataContext) {
            val row = selectedRow() ?: return
            if (!deletable(row.dto)) return
            showDeletePopup(row.dto)
        }
    }

    private inner class RenameAction : AnAction(
        KiloBundle.message("worktree.rename.action"),
        null,
        AllIcons.Actions.Edit,
    ) {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = renameable(selectedRow()?.dto)
        }

        override fun actionPerformed(e: AnActionEvent) {
            selectedRow()?.dto?.takeIf(::renameable)?.let { beginRename(it) }
        }
    }

    /**
     * Inner (not data) class so [metrics] can bind each row's changes/PR handlers to the panel.
     * Value equality is over the data fields only — the derived handlers are intentionally excluded
     * so a stats/PR refresh that produced identical rows still skips the model rebuild in
     * [ActiveListView].
     */
    private inner class WorktreeRow(
        val dto: WorktreeDto,
        override val progress: String?,
        val kind: SessionActivityKind?,
        val stats: WorktreeStatsDto?,
        val pr: WorktreePrDto?,
        val current: Boolean = false,
    ) : ActiveListItem {
        override val key: String get() = dto.id
        override val identity: Any get() = if (current) "local:${dto.path}" else "worktree:${dto.path}"
        override val title: String get() = if (current) dto.branch else WorktreeTitle.text(dto.name, dto.path, pr)
        override val description: String get() = WorktreeTitle.fallback(dto.path)
        override val tooltip: String? get() = null
        override val icon = WorktreeIcons.forRow(progress != null, kind, dto.locked, current)
        override val tinted: Boolean get() = WorktreeIcons.neutral(icon)
        override val section: String? get() = if (current) null else KiloBundle.message("worktree.section.local")
        override val search: String get() = listOfNotNull(dto.name, dto.branch, dto.path, dto.lockReason).joinToString(" ")
        private val customName: String? get() = WorktreeTitle.custom(dto.name, dto.path)
        override val metrics: ActiveListMetrics?
            get() {
                if (progress != null) return null
                val s = stats
                val p = pr
                if (s == null && p == null) return null
                return ActiveListMetrics(
                    additions = s?.additions ?: 0,
                    deletions = s?.deletions ?: 0,
                    ahead = s?.ahead ?: 0,
                    behind = s?.behind ?: 0,
                    pr = p?.let { ActiveListBadge("#${it.number}", style(it.state)) },
                    prTooltip = p?.let { prTooltip(it, customName) },
                    onChanges = s?.let { { openBranchDiff(dto.path) } },
                    onPr = p?.url?.let { url -> { BrowserUtil.browse(url) } },
                )
            }

        override fun equals(other: Any?): Boolean {
            val row = other as? WorktreeRow ?: return false
            return dto == row.dto &&
                progress == row.progress &&
                kind == row.kind &&
                stats == row.stats &&
                pr == row.pr &&
                current == row.current
        }

        override fun hashCode(): Int {
            var result = dto.hashCode()
            result = 31 * result + (progress?.hashCode() ?: 0)
            result = 31 * result + (kind?.hashCode() ?: 0)
            result = 31 * result + (stats?.hashCode() ?: 0)
            result = 31 * result + (pr?.hashCode() ?: 0)
            result = 31 * result + current.hashCode()
            return result
        }
    }

    @RequiresEdt
    private fun openBranchDiff(path: String) {
        val target = project ?: return
        ensureDiffEditorKind()
        target.service<KiloVfsManager>().open(
            KiloDiffEditorKind.ID,
            diffParams("branch", path, null, KiloBundle.message("diff.editor.branch.title")),
        )
    }
}

internal fun worktreeDeletable(item: WorktreeDto?, busy: Boolean): Boolean = item != null && !item.main && !busy
