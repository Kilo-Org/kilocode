package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.ChatDockKeys
import ai.kilocode.rpc.dto.MoveStage
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon

/**
 * "Move to Worktree" action shown in the chat branch dock. Visible only when there is something to
 * move (a conversation or local changes). While a move runs it stays visible but disabled, showing a
 * spinner and the current stage.
 */
class ChatMoveToWorktreeAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.putClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR, true)
        val dock = e.getData(ChatDockKeys.DOCK)
        if (dock == null) {
            e.presentation.isEnabledAndVisible = false
            return
        }
        if (dock.moving()) {
            e.presentation.isVisible = true
            e.presentation.isEnabled = false
            e.presentation.icon = AnimatedIcon.Default.INSTANCE
            e.presentation.text = progressLabel(dock.moveStage())
            e.presentation.description = null
            return
        }
        e.presentation.isEnabledAndVisible = dock.moveEnabled()
        e.presentation.icon = BRANCH
        e.presentation.text = KiloBundle.message("session.dock.move")
        e.presentation.description = moveTooltip(dock.changeCount())
    }

    override fun actionPerformed(e: AnActionEvent) {
        e.getData(ChatDockKeys.DOCK)?.triggerMove()
    }

    private fun progressLabel(stage: MoveStage?): String = when (stage) {
        MoveStage.CAPTURING -> KiloBundle.message("session.dock.progress.capturing")
        MoveStage.CREATING -> KiloBundle.message("session.dock.progress.creating")
        MoveStage.TRANSFERRING -> KiloBundle.message("session.dock.progress.transferring")
        MoveStage.FORKING -> KiloBundle.message("session.dock.progress.forking")
        else -> KiloBundle.message("session.dock.move")
    }

    private fun moveTooltip(count: Int): String = when (count) {
        0 -> KiloBundle.message("session.dock.move.tooltip.empty")
        1 -> KiloBundle.message("session.dock.move.tooltip.one")
        else -> KiloBundle.message("session.dock.move.tooltip.other", count)
    }

    private companion object {
        private val BRANCH = IconLoader.getIcon("/icons/worktreeBranch.svg", ChatMoveToWorktreeAction::class.java)
    }
}
