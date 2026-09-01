package ai.kilocode.client.agentManager

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.actions.CopySessionPrRefAction
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
import ai.kilocode.client.agentManager.worktree.runWorktreeSetupScript
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.WorktreeRowPopupBody
import ai.kilocode.client.agentManager.worktree.WorktreeTitle
import ai.kilocode.client.agentManager.worktree.openWorktreeSession
import ai.kilocode.client.agentManager.worktree.normalizeWorktreePath
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.checksTooltip
import ai.kilocode.client.ui.checksUrl
import ai.kilocode.client.ui.popup.SidePopupContent
import ai.kilocode.client.ui.popup.SidePopupController
import ai.kilocode.client.ui.popup.SidePopupFit
import ai.kilocode.client.ui.popup.SidePopupGeometry
import ai.kilocode.client.ui.popup.SidePopupRequest
import ai.kilocode.client.ui.popup.SidePopupSpot
import ai.kilocode.client.ui.openTooltip
import ai.kilocode.client.ui.reviewTooltip
import ai.kilocode.client.ui.style
import ai.kilocode.client.diff.KiloDiffComparison
import ai.kilocode.client.diff.openKiloDiff
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
import ai.kilocode.rpc.dto.WorktreeDirtyDto
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
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Component
import java.awt.Point
import java.awt.Rectangle
import java.awt.datatransfer.StringSelection
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener
import javax.swing.JComponent
import javax.swing.SwingUtilities

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
            // The review and CI glyphs are read as a column down the list, so they line up with the
            // changes summary and PR pill below them rather than following each title's own width.
            badgesRight = true,
        ),
        surface = ActiveListSurface.ToolWindow,
        showSearch = false,
        onCell = { _, _ -> },
        onOpen = { row, focus ->
            val item = (row as? WorktreeRow)?.dto ?: return@ActiveList
            open(item, focus)
        },
        menu = ActiveListMenu(WorktreeDataKeys.WORKTREE, group, element = { row ->
            (row as? WorktreeRow)?.dto?.takeIf {
                canRename(it) || canDelete(it) || canOpenPr(it) || canOpenDiff(it) || canOpenLocalDiff(it) ||
                    canOpenSetupScript(it) || canRunSetup(it) || canCopyBranch(it)
            }
        }),
        reorder = ActiveListReorder(
            movable = { row -> row is WorktreeRow && !row.current && row.progress == null },
            onMove = { move -> controller.reorder(move.keys) },
        ),
        onHover = { row -> hover(row) },
    )
    // Rows are dense and neighbours are only ever passed over on the way somewhere else, so the dwell is
    // longer here than for a transcript card the pointer goes to on purpose.
    private val popup = SidePopupController(dwell = SidePopupController.LIST_MS)
    private var stats: Map<String, WorktreeStatsDto> = emptyMap()
    private var prs: Map<String, WorktreePrDto> = emptyMap()
    private var dirty: Map<String, WorktreeDirtyDto> = emptyMap()
    private var hovered: String? = null

    init {
        Disposer.register(parent, this)
        Disposer.register(this, popup)
        // A row that scrolls or gets selected is no longer under the balloon that points at it, and a
        // busy list or a rebuilt model has already dropped the hover the popup was opened from.
        list.onScroll = { popup.hideAll() }
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
        // A fresh worktree changes what git reports, so bypass both the refresh throttle and the
        // backend's PR cache — that cache was populated before this worktree existed, so serving it
        // would leave the new row without its badge until the entry aged out.
        controller.onCreated = { created ->
            project?.service<WorktreeStatusService>()?.refreshStats()
            project?.service<WorktreeStatusService>()?.refreshPr(force = true, maxAge = 0)
            autoRunSetupScript(created)
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
            border = JBUI.Borders.empty(UiStyle.Gap.SM)
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

    internal fun canOpenPr(item: WorktreeDto?): Boolean = prDto(item) != null

    internal fun openPr(item: WorktreeDto) = prDto(item)?.let { BrowserUtil.browse(it.url) }

    internal fun copyPrRef(item: WorktreeDto) {
        val pr = prDto(item) ?: return
        Telemetry.send("Worktree Action", mapOf("action" to "copy_pr_ref"))
        CopyPasteManager.getInstance().setContents(StringSelection(CopySessionPrRefAction.reference(pr)))
    }

    /** The PR for [item], or null when it has none or is not in a stable, openable state. */
    private fun prDto(item: WorktreeDto?): WorktreePrDto? {
        if (item == null) return null
        if (controller.progress(item.id) != null) return null
        return prs[normalizeWorktreePath(item.path)]
    }

    internal fun canOpenDiff(item: WorktreeDto?): Boolean {
        if (item == null || item.main || project == null) return false
        return controller.progress(item.id) == null
    }

    @RequiresEdt
    internal fun openDiff(item: WorktreeDto) {
        val target = project ?: return
        if (!canOpenDiff(item)) return
        openKiloDiff(target, item.path, KiloDiffComparison.BASE, item.branch.takeUnless { it == "(detached)" })
    }

    internal fun canOpenLocalDiff(item: WorktreeDto?): Boolean {
        if (item == null || item.main || project == null) return false
        return controller.progress(item.id) == null
    }

    @RequiresEdt
    internal fun openLocalDiff(item: WorktreeDto) {
        val target = project ?: return
        if (!canOpenLocalDiff(item)) return
        openKiloDiff(target, item.path, KiloDiffComparison.LOCAL)
    }

    /** Copying the branch name/path works for any worktree row, including the main one. */
    internal fun canCopyBranch(item: WorktreeDto?): Boolean = item != null

    /** The Open/Create setup-script action is repo-scoped, so it never targets the main worktree row. */
    internal fun canOpenSetupScript(item: WorktreeDto?): Boolean = item != null && !item.main

    internal fun canRunSetup(item: WorktreeDto?): Boolean {
        if (item == null || item.main) return false
        if (controller.progress(item.id) != null) return false
        val service = service<KiloWorkspaceService>()
        val target = service.setupScript[controller.directory] ?: run {
            service.refreshSetupScriptTarget(controller.directory)
            return false
        }
        return target.exists
    }

    @RequiresEdt
    internal fun runSetup(item: WorktreeDto) {
        val target = project ?: return
        if (!canRunSetup(item)) return
        val script = service<KiloWorkspaceService>().setupScript[controller.directory] ?: return
        Telemetry.send("Worktree Setup Script Run", mapOf("surface" to "worktree_row"))
        runWorktreeSetupScript(target, script, item.path, controller.directory)
    }

    /**
     * Fires the setup script right after worktree creation, mirroring VS Code's trigger point but not
     * its blocking semantics: this does not await the script or gate session creation. Silently does
     * nothing when [created] is the main worktree or no script is configured, matching VS Code.
     */
    @RequiresEdt
    private fun autoRunSetupScript(created: WorktreeDto) {
        if (created.main) return
        val target = project ?: return
        service<KiloWorkspaceService>().ifSetupScriptExists(controller.directory) { script ->
            Telemetry.send("Worktree Setup Script Run", mapOf("surface" to "auto"))
            runWorktreeSetupScript(target, script, created.path, controller.directory)
        }
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
        return prDto(item) == null
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
                    dirty[key],
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

    /**
     * Opens the row detail popup on hover, or begins hiding it when the pointer leaves the list. Keyed by
     * worktree path so a model rebuild that replaces row objects does not read as a different row.
     */
    @RequiresEdt
    private fun hover(row: ActiveListItem?) {
        val item = row as? WorktreeRow
        if (item == null) {
            popup.notifyExit(hovered ?: return)
            hovered = null
            return
        }
        val key = item.dto.path
        hovered = key
        popup.show(key, this) { request(item) }
    }

    /**
     * The hover detail for one row, or null when the row has nothing to detail. A pull request is not the
     * bar: a worktree that has no pull request yet is exactly the one whose changes are still uncommitted,
     * and this popup is the only place that breaks those out. What it will not do is follow the pointer
     * down a list of untouched worktrees as an empty balloon.
     */
    @RequiresEdt
    private fun request(row: WorktreeRow): SidePopupRequest? {
        if (project == null || row.progress != null) return null
        val key = normalizeWorktreePath(row.dto.path)
        val pull = row.pr
        val base = stats[key]
        val local = dirty[key]
        val any = pull != null ||
            (local != null && local.files > 0) ||
            (base != null && (base.files > 0 || base.ahead > 0 || base.behind > 0))
        if (!any) return null
        return SidePopupRequest(
            build = {
                val disposable = Disposer.newDisposable("Worktree row popup")
                val body = WorktreeRowPopupBody(
                    openDiff = { openDiff(row.dto) },
                    onLocal = { openLocalDiff(row.dto) },
                )
                body.update(base, pull, WorktreeTitle.fallback(row.dto.path), local)
                // A PR title is as long as its author made it, and the popup exists to show the whole
                // thing: past the width cap it scrolls sideways rather than losing the end of the line.
                HeaderPopupBody(body, disposable, UiStyle.Balloon.bg(), maxWidth = POPUP_WIDTH, horizontal = true)
            },
            place = { built -> place(built) },
        )
    }

    /**
     * Places the balloon beside the hovered row on whichever side has more room, never above or below it.
     * Height is budgeted against the visible list rather than the window, so a popup cannot run past the
     * tool window into a neighbouring panel.
     */
    @RequiresEdt
    private fun place(built: SidePopupContent): SidePopupSpot? {
        val pane = SwingUtilities.getRootPane(list)?.layeredPane ?: return null
        val subject = list.hoveredBounds(pane) ?: return null
        val area = list.visibleBounds(pane) ?: return null
        val gap = UiStyle.Gap.pad()
        val insets = UiStyle.Balloon.insets()
        // The shadow is reserved on every side, so it counts twice on each axis.
        val shadow = UiStyle.Balloon.shadow()
        val spot = SidePopupGeometry.beside(
            pane = Rectangle(pane.size),
            subject = subject,
            view = area,
            fit = SidePopupFit(
                chromeWidth = insets.left + insets.right + UiStyle.Balloon.pointer().height + shadow * 2,
                chromeHeight = insets.top + insets.bottom + shadow * 2,
                gap = gap,
                maxWidth = JBUI.scale(POPUP_WIDTH),
                maxHeight = JBUI.scale(POPUP_HEIGHT),
            ),
        )
        built.fitWithin(spot.maxWidth, spot.maxHeight)
        val view = Rectangle(area.x, area.y + shadow, area.width, (area.height - shadow * 2).coerceAtLeast(0))
        val height = built.component.preferredSize.height + insets.top + insets.bottom
        val aim = SidePopupGeometry.aim(
            view = view,
            subject = subject,
            y = subject.y + subject.height / 2,
            height = height,
            gap = gap,
            indent = UiStyle.Balloon.arc() + UiStyle.Balloon.pointer().width / 2,
        )
        return SidePopupSpot(pane, Point(spot.x, aim.y), spot.position, aim.distance)
    }

    private fun bindStatus() {
        val target = project ?: return
        WorktreeStatusBinding(
            target,
            this,
            onStats = { value -> stats = value; sync() },
            onPr = { value -> prs = value; sync() },
            // Rows carry the uncommitted counts too, as the summary a worktree with no commits yet shows,
            // so a poll has to rebuild them. Row equality keeps a poll that found nothing new from churning.
            onDirty = { value -> dirty = value; sync() },
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

    private companion object {
        // Wider than a chat card popup: PR titles are conventional commit lines and the summary row puts
        // the committed and uncommitted counts beside each other. This is only a cap — the popup asks for
        // the width its content needs and [SidePopupGeometry.beside] trims it to the room beside the row,
        // so a narrow window gets a narrow popup rather than one re-pointed above the list.
        const val POPUP_WIDTH = 1840
        const val POPUP_HEIGHT = 320
    }

    private inner class WorktreeRow(
        val dto: WorktreeDto,
        override val progress: String?,
        val kind: SessionActivityKind?,
        val stats: WorktreeStatsDto?,
        val pr: WorktreePrDto?,
        val dirty: WorktreeDirtyDto? = null,
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

        /**
         * Review then CI verdict, on the title line so they stay readable without hovering the row.
         * Both are glyphs rather than pills: they are the states a reviewer scans a worktree list for,
         * and GitHub's own icons say it faster than words at this size.
         */
        override val badges: List<ActiveListBadge>
            get() {
                if (progress != null) return emptyList()
                val p = pr ?: return emptyList()
                return listOfNotNull(reviewBadge(p), checksBadge(p))
            }

        private fun reviewBadge(p: WorktreePrDto): ActiveListBadge? {
            val glyph = PrIcons.review(p.review) ?: return null
            return ActiveListBadge(
                "",
                id = "pr-review",
                tooltip = reviewTooltip(p.review),
                action = { BrowserUtil.browse(p.url) },
                icon = glyph,
            )
        }

        private fun checksBadge(p: WorktreePrDto): ActiveListBadge? {
            val glyph = PrIcons.checks(p.checks) ?: return null
            return ActiveListBadge(
                "",
                id = "pr-checks",
                tooltip = checksTooltip(p.checks),
                // The checks tab rather than the conversation: someone clicking a red build wants the log.
                action = { BrowserUtil.browse(checksUrl(p)) },
                icon = glyph,
            )
        }

        override val secondaryBadges: List<ActiveListBadge>
            get() {
                if (progress != null) return emptyList()
                val p = pr ?: return emptyList()
                return listOf(
                    ActiveListBadge(
                        "#${p.number}",
                        style(p.state),
                        id = "pull-request",
                        tooltip = openTooltip(),
                        action = { BrowserUtil.browse(p.url) },
                    ),
                )
            }
        /**
         * Committed counts against the base branch, with the uncommitted ones behind them so a worktree
         * whose agent has not committed yet still says what it changed. A row that showed nothing until
         * the first commit reads as "no changes here", which is the state this summary exists to deny.
         */
        override val metrics: ActiveListMetrics?
            get() {
                if (progress != null) return null
                if ((stats?.files ?: 0) == 0 && (dirty?.files ?: 0) == 0) return null
                return ActiveListMetrics(
                    files = stats?.files ?: 0,
                    additions = stats?.additions ?: 0,
                    deletions = stats?.deletions ?: 0,
                    base = stats?.base.orEmpty(),
                    onChanges = { openDiff(dto) },
                    localFiles = dirty?.files ?: 0,
                    localAdditions = dirty?.additions ?: 0,
                    localDeletions = dirty?.deletions ?: 0,
                    onLocal = { openLocalDiff(dto) },
                )
            }

        override fun equals(other: Any?): Boolean {
            val row = other as? WorktreeRow ?: return false
            return dto == row.dto &&
                progress == row.progress &&
                kind == row.kind &&
                stats == row.stats &&
                pr == row.pr &&
                dirty == row.dirty &&
                current == row.current
        }

        override fun hashCode(): Int {
            var result = dto.hashCode()
            result = 31 * result + (progress?.hashCode() ?: 0)
            result = 31 * result + (kind?.hashCode() ?: 0)
            result = 31 * result + (stats?.hashCode() ?: 0)
            result = 31 * result + (pr?.hashCode() ?: 0)
            result = 31 * result + (dirty?.hashCode() ?: 0)
            result = 31 * result + current.hashCode()
            return result
        }
    }
}

internal fun worktreeDeletable(item: WorktreeDto?, busy: Boolean): Boolean = item != null && !item.main && !busy
