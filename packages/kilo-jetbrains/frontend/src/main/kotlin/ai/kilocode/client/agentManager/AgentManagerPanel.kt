package ai.kilocode.client.agentManager

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.worktree.ConfigureWorktreeDialog
import ai.kilocode.client.agentManager.worktree.DeleteWorktreeDialog
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
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
) : BorderLayoutPanel(), Disposable {
    private val list = ActiveList(
        KiloBundle.message("worktree.empty"),
        placeholder = KiloBundle.message("worktree.search.placeholder"),
        onCell = { key, id ->
            if (id != DELETE_CELL) return@ActiveList
            val item = item(key) ?: return@ActiveList
            if (!item.main) confirm(item)
        },
    )

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
        addToCenter(list)
        sync()
        bindModel()
        bindTheme()
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

    private fun confirm(item: WorktreeDto) {
        val dialog = DeleteWorktreeDialog(this, item)
        if (!dialog.showAndGet()) return
        remove(item, dialog.forceRequested)
    }

    private fun remove(item: WorktreeDto, force: Boolean) {
        controller.remove(item, force) { result -> notifyFailed(item, result, force) }
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
        list.update((0 until controller.model.size).map { WorktreeRow(controller.model.getElementAt(it)) }, ActiveListSelection.PreserveNoScroll)
    }

    private fun item(key: String): WorktreeDto? {
        return (0 until controller.model.size)
            .map { controller.model.getElementAt(it) }
            .firstOrNull { it.id == key }
    }

    override fun dispose() {}

    private data class WorktreeRow(val dto: WorktreeDto) : ActiveListItem {
        override val key: String get() = dto.id
        override val title: String get() = dto.name
        override val note: String get() = dto.branch
        override val description: String?
            get() = if (!dto.locked) null else dto.lockReason?.let { KiloBundle.message("worktree.locked.reason", it) }
                ?: KiloBundle.message("worktree.locked")
        override val icon = AllIcons.Nodes.Locked.takeIf { dto.locked }
        override val search: String get() = listOfNotNull(dto.branch, dto.path, dto.lockReason).joinToString(" ")
        override val cells: List<ActiveListCell>
            get() = if (dto.main) emptyList() else listOf(ActiveListCell(
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
