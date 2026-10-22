package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.ChatDockKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.util.IconLoader

/**
 * "Move to Worktree" action shown in the chat branch dock. Visible only when there is something to
 * move (a conversation or local changes). Without a session the wording drops the conversation: the
 * move copies the local changes into the worktree and starts a fresh session there.
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
        e.presentation.isEnabledAndVisible = dock.moveEnabled()
        e.presentation.icon = BRANCH
        e.presentation.text = KiloBundle.message("session.dock.move")
        e.presentation.description = moveTooltip(dock.changeCount(), dock.hasSession())
    }

    override fun actionPerformed(e: AnActionEvent) {
        e.getData(ChatDockKeys.DOCK)?.triggerMove()
    }

    private fun moveTooltip(count: Int, session: Boolean): String = when {
        session && count == 0 -> KiloBundle.message("session.dock.move.tooltip.empty")
        session && count == 1 -> KiloBundle.message("session.dock.move.tooltip.one")
        session -> KiloBundle.message("session.dock.move.tooltip.other", count)
        count == 1 -> KiloBundle.message("session.dock.move.tooltip.changes.one")
        else -> KiloBundle.message("session.dock.move.tooltip.changes.other", count)
    }

    private companion object {
        private val BRANCH = IconLoader.getIcon("/icons/worktreeBranch.svg", ChatMoveToWorktreeAction::class.java)
    }
}
