package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class OpenWorktreeDiffAction : AnAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL)
        val item = e.getData(WorktreeDataKeys.WORKTREE)
        e.presentation.isEnabledAndVisible = panel != null && panel.canOpenDiff(item)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL) ?: return
        val item = e.getData(WorktreeDataKeys.WORKTREE) ?: return
        if (panel.canOpenDiff(item)) panel.openDiff(item)
    }
}
