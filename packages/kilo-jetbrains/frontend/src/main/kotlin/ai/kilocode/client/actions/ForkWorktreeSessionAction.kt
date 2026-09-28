package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.worktree.WorktreeSessionDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

class ForkWorktreeSessionAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val panel = e.getData(WorktreeSessionDataKeys.PANEL)
        val item = e.getData(WorktreeSessionDataKeys.SESSION)
        e.presentation.isEnabledAndVisible = panel != null && panel.canFork(item)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = e.getData(WorktreeSessionDataKeys.PANEL) ?: return
        val item = e.getData(WorktreeSessionDataKeys.SESSION) ?: return
        if (panel.canFork(item)) panel.forkRow(item)
    }
}
