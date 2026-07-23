package ai.kilocode.client.agentManager

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.worktree.ConfigureWorktreeDialog
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.showWorktreeDeletePopup
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.icons.AllIcons
import com.intellij.ide.DeleteProvider
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
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
    private val list = ActiveList(
        KiloBundle.message("worktree.empty"),
        placeholder = KiloBundle.message("worktree.search.placeholder"),
        onCell = { key, id ->
            if (id != DELETE_CELL) return@ActiveList
            val item = item(key) ?: return@ActiveList
            if (worktreeDeletable(item, controller.isPending(item.id))) showDeletePopup(item, id)
        },
    )

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
        addToCenter(list)
        sync()
        bindModel()
        bindTheme()
        controller.onSelect = { key ->
            // Focus the list so the freshly created worktree renders as an active selection rather
            // than the muted, inactive highlight it would get while focus stays on the toolbar.
            if (list.select(key)) list.focusList()
        }
        controller.onCreateFailure = { err -> notifyCreateFailed(err) }
    }

    val component: JComponent get() = this

    fun refresh() = controller.reload()

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

    private fun showDeletePopup(item: WorktreeDto, cell: String? = null) {
        val idx = list.selectedIndex().takeIf { it >= 0 } ?: controller.model.getElementIndex(item)
        val balloon = showWorktreeDeletePopup(list.point(item.id, cell), item) { force ->
            controller.remove(
                item,
                force,
                onSuccess = { restoreFocus(idx) },
                onFailure = { result -> notifyFailed(item, result, force) },
            )
        }
        list.trackBalloon(balloon)
    }

    /**
     * After a delete, move the selection to the row that took the deleted row's place (the next
     * worktree) rather than letting the list reset to the top. [index] is the removed row's index,
     * captured before removal, so the same index now points at the following row.
     */
    private fun restoreFocus(index: Int) {
        val size = controller.model.size
        if (size > 0) list.selectIndex(index.coerceIn(0, size - 1))
        list.focusList()
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
        list.update(
            (0 until controller.model.size).map {
                val item = controller.model.getElementAt(it)
                WorktreeRow(item, controller.isPending(item.id))
            },
            ActiveListSelection.PreserveNoScroll,
        )
    }

    private fun item(key: String): WorktreeDto? {
        return (0 until controller.model.size)
            .map { controller.model.getElementAt(it) }
            .firstOrNull { it.id == key }
    }

    override fun dispose() {}

    override fun uiDataSnapshot(sink: DataSink) {
        sink[PlatformDataKeys.DELETE_ELEMENT_PROVIDER] = provider
    }

    private fun selectedRow(): WorktreeRow? = list.selected() as? WorktreeRow

    private inner class WorktreeDeleteProvider : DeleteProvider {
        override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

        override fun canDeleteElement(dataContext: DataContext): Boolean {
            val row = selectedRow()
            return worktreeDeletable(row?.dto, row?.pending == true)
        }

        override fun deleteElement(dataContext: DataContext) {
            val row = selectedRow() ?: return
            if (!worktreeDeletable(row.dto, row.pending)) return
            showDeletePopup(row.dto)
        }
    }

    private data class WorktreeRow(val dto: WorktreeDto, val pending: Boolean) : ActiveListItem {
        override val key: String get() = dto.id
        override val title: String get() = dto.name
        override val description: String get() = dto.path.trimEnd('/').substringAfterLast('/')
        override val tooltip: String get() = dto.path
        override val icon = WorktreeIcons.forRow(dto.locked, pending)
        override val search: String get() = listOfNotNull(dto.name, dto.branch, dto.path, dto.lockReason).joinToString(" ")
        override val cells: List<ActiveListCell>
            get() = if (dto.main || pending) emptyList() else listOf(ActiveListCell(
                DELETE_CELL,
                KiloBundle.message("worktree.delete.action"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ))
    }

    private companion object {
        const val DELETE_CELL = "delete"
    }
}

internal fun worktreeDeletable(item: WorktreeDto?, pending: Boolean): Boolean = item != null && !item.main && !pending
