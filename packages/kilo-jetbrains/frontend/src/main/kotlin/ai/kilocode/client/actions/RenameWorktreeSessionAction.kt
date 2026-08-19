package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.worktree.WorktreeSessionDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class RenameWorktreeSessionAction : AnAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val panel = e.getData(WorktreeSessionDataKeys.PANEL)
        val item = e.getData(WorktreeSessionDataKeys.SESSION)
        e.presentation.isEnabledAndVisible = panel != null && panel.canRename(item)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = e.getData(WorktreeSessionDataKeys.PANEL) ?: return
        val item = e.getData(WorktreeSessionDataKeys.SESSION) ?: return
        if (panel.canRename(item)) panel.renameRow(item)
    }
}
