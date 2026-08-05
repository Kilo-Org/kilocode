package ai.kilocode.client.agentManager

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.worktree.ConfigureWorktreeDialog
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.WorktreeNameCache
import ai.kilocode.client.agentManager.worktree.WorktreeEditorMatchers
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorMatcher
import ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.ensureWorktreeSessionEditorKind
import ai.kilocode.client.agentManager.worktree.worktreeActivityBadge
import ai.kilocode.client.agentManager.worktree.worktreeSessionParams
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ACTIVE_LIST_DELETE_CELL
import ai.kilocode.client.ui.list.ACTIVE_LIST_RENAME_CELL
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListDeleteOptions
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListSurface
import ai.kilocode.client.ui.list.activeListDeleteCell
import ai.kilocode.client.ui.list.activeListRenameCell
import ai.kilocode.client.ui.list.activeListToolWindowBackground
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.icons.AllIcons
import com.intellij.ide.DeleteProvider
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
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
) : BorderLayoutPanel(), Disposable, UiDataProvider {
    private val provider = WorktreeDeleteProvider()
    private val edit = RenameAction()
    private val list = ActiveList(
        KiloBundle.message("worktree.empty"),
        cfg = ActiveListConfig(hoverActions = true),
        surface = ActiveListSurface.ToolWindow,
        showSearch = false,
        onCell = { key, id ->
            val item = item(key) ?: return@ActiveList
            if (id == ACTIVE_LIST_RENAME_CELL && renameable(item)) beginRename(item, id)
            if (id == ACTIVE_LIST_DELETE_CELL && deletable(item)) showDeletePopup(item, id)
        },
        onOpen = { row, focus ->
            val item = (row as? WorktreeRow)?.dto ?: return@ActiveList
            open(item, focus)
        },
        onSelect = { selectedRow()?.dto?.id?.let { selected = it } },
    )
    private var selected: String? = null

    init {
        Disposer.register(parent, this)
        isOpaque = true
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
        addToCenter(list)
        sync()
        bindModel()
        bindTheme()
        controller.onSelect = { key ->
            // Focus the list so the freshly created worktree renders as an active selection rather
            // than the inactive highlight it would get while focus stays on the toolbar.
            if (list.select(key)) list.focusList()
            item(key)?.takeIf { !controller.isPending(it.id) }?.let { open(it, focus = false) }
        }
        controller.onCreateFailure = { err -> notifyCreateFailed(err) }
        controller.onRemoveSuccess = { item, index -> onRemoved(item, index) }
        controller.onActivityChanged = { sync() }
        bindEditorSelection()
        // Reflect names adopted or renamed in a worktree session editor tab in the list live.
        service<WorktreeNameCache>().addListener(this) { path, name -> controller.applyName(path, name) }
        ActionManager.getInstance().getAction("RenameElement")?.shortcutSet?.let { set ->
            edit.registerCustomShortcutSet(set, list, this)
        }
    }

    val component: JComponent get() = this

    override fun getBackground(): Color = activeListToolWindowBackground()

    fun refresh() {
        selected = currentEditorWorktree()
        controller.reload()
    }

    /** Branch shown in the quick "New Worktree from …" menu item. */
    fun defaultBranch(): String = controller.defaultBranch

    /** Immediately creates a worktree with a generated friendly name off [defaultBranch]. */
    fun quickCreate() = controller.quickCreate()

    /** Opens the advanced dialog to pick a branch name and base branch. */
    fun configure() {
        val dialog = ConfigureWorktreeDialog(this, controller.suggestName(), controller.defaultBranch, controller.branches)
        if (dialog.showAndGet()) controller.create(dialog.branch, dialog.baseBranch)
    }

    private fun remove(item: WorktreeDto, force: Boolean) {
        controller.remove(item, force, onFailure = { result -> notifyFailed(item, result, force) })
    }

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
        if (item.main || controller.isPending(item.id)) return
        ensureWorktreeSessionEditorKind()
        target.service<KiloVfsManager>().open(WorktreeSessionEditorKind.ID, worktreeSessionParams(item), focus)
    }

    private fun close(item: WorktreeDto) {
        val target = project ?: return
        target.service<KiloVfsManager>().close(WorktreeSessionEditorKind.ID, worktreeSessionParams(item))
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
        if (!worktreeDeletable(item, item?.id?.let(controller::isPending) == true)) return false
        return item?.id?.let(controller::isDeleting) != true
    }

    private fun renameable(item: WorktreeDto?): Boolean {
        if (item == null || item.main) return false
        return !controller.isPending(item.id) && !controller.isDeleting(item.id)
    }

    /**
     * Reacts to a confirmed deletion. When the removed worktree is the one on screen, advances the
     * selection to the row that slid into its slot ([index] now points at the following row, or the
     * last row when the removed row was last) and opens it before closing the deleted tab so the
     * neighbour becomes the active editor. Deleting a background row leaves the selection untouched.
     *
     * The active editor is read before close(item) as the ground-truth "shown" signal; the
     * `selected` field is unreliable here because the model rebuild in sync() transiently reselects
     * row 0 through the list's onSelect hook.
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
        selected = next?.id
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

    private fun notifyCreateFailed(err: String?) {
        KiloNotifications.error(project, KiloBundle.message("worktree.create.failed.title"), err)
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

    private fun bindTheme() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                SwingUtilities.updateComponentTreeUI(this)
            }
        })
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
        val key = selected
        list.update(
            (0 until controller.model.size).map {
                val item = controller.model.getElementAt(it)
                WorktreeRow(item, controller.isPending(item.id), controller.isDeleting(item.id), controller.kind(item.path))
            },
            ActiveListSelection.PreserveNoScroll,
        )
        if (key != null) {
            if (!list.select(key, scroll = false)) list.clearSelection()
            return
        }
        list.clearSelection()
        selected = null
    }

    @RequiresEdt
    private fun track(file: VirtualFile?) {
        val key = project?.service<WorktreeEditorMatchers>()?.match(file)
        if (key != null) {
            selected = key
            list.select(key, scroll = false)
            return
        }
        // A null active editor is a transient state (e.g. a tab closing during a delete); keep the
        // current selection. Only a real, non-worktree editor clears the worktree row selection.
        if (file == null) return
        selected = null
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

    override fun dispose() {
        controller.onSelect = null
        controller.onCreateFailure = null
        controller.onRemoveSuccess = null
        controller.onActivityChanged = null
    }

    override fun uiDataSnapshot(sink: DataSink) {
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

    private data class WorktreeRow(
        val dto: WorktreeDto,
        val pending: Boolean,
        override val deleting: Boolean,
        val kind: SessionActivityKind?,
    ) : ActiveListItem {
        override val key: String get() = dto.id
        override val title: String get() = dto.name
        override val description: String get() = dto.path.trimEnd('/').substringAfterLast('/')
        override val tooltip: String get() = dto.path
        override val icon = WorktreeIcons.forRow(dto.locked, pending)
        override val search: String get() = listOfNotNull(dto.name, dto.branch, dto.path, dto.lockReason).joinToString(" ")
        override val badges: List<ActiveListBadge>
            get() {
                if (pending || deleting) return emptyList()
                return listOfNotNull(kind?.let(::worktreeActivityBadge))
            }
        override val cells: List<ActiveListCell>
            get() = if (dto.main || pending) emptyList() else listOf(
                activeListRenameCell(KiloBundle.message("worktree.rename.action")),
                activeListDeleteCell(KiloBundle.message("worktree.delete.action")),
            )
    }
}

internal fun worktreeDeletable(item: WorktreeDto?, pending: Boolean): Boolean = item != null && !item.main && !pending
