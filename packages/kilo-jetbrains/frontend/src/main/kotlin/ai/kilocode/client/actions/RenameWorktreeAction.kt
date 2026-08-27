package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class RenameWorktreeAction : AnAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL)
        val item = e.getData(WorktreeDataKeys.WORKTREE)
        val visible = panel != null && panel.canShowRename(item)
        e.presentation.isVisible = visible
        e.presentation.isEnabled = visible && panel.canRename(item)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL) ?: return
        val item = e.getData(WorktreeDataKeys.WORKTREE) ?: return
        if (panel.canRename(item)) panel.rename(item)
    }
}
