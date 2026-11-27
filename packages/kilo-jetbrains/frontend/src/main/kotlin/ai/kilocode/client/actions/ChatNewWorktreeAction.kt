package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.ChatDockKeys
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAware

/**
 * "New Worktree" action shown in the chat branch dock. Visible only while the dock is active (the
 * session has a conversation or local changes), so it never appears on its own in an empty session.
 */
class ChatNewWorktreeAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val dock = e.getData(ChatDockKeys.DOCK)
        e.presentation.isEnabledAndVisible = dock?.newWorktreeEnabled() == true
        e.presentation.icon = AllIcons.General.Add
        e.presentation.text = KiloBundle.message("session.dock.newWorktree")
        e.presentation.description = KiloBundle.message("session.dock.newWorktree.tooltip")
        e.presentation.putClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR, true)
    }

    override fun actionPerformed(e: AnActionEvent) {
        e.getData(ChatDockKeys.DOCK)?.triggerNewWorktree()
    }
}
