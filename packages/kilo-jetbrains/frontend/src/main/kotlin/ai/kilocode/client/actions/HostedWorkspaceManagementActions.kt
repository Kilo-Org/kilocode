package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerPanel
import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

abstract class HostedWorkspaceAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    protected fun panel(e: AnActionEvent): AgentManagerPanel? =
        e.getData(SidePanelKeys.WORKTREE_PANEL)
}

class HostedRemoveWorkspaceAction : HostedWorkspaceAction() {
    override fun update(e: AnActionEvent) {
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE)
        val pending = item?.ref?.workspaceID?.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) == true
        e.presentation.isVisible = item != null && !pending
        e.presentation.isEnabled = item != null && !pending
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return
        panel.removeHosted(item)
    }
}

class HostedDeleteWorkspaceAction : HostedWorkspaceAction() {
    override fun update(e: AnActionEvent) {
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE)
        val pending = item?.ref?.workspaceID?.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) == true
        e.presentation.isVisible = item != null && !pending
        e.presentation.isEnabled = item != null && !pending
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return
        panel.deleteHosted(item)
    }
}

class HostedDismissWorkspaceAction : HostedWorkspaceAction() {
    override fun update(e: AnActionEvent) {
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE)
        val pending = item?.ref?.workspaceID?.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) == true
        val deleted = item?.deletionState == "deleted" && !pending
        e.presentation.isVisible = deleted
        e.presentation.isEnabled = deleted
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return
        panel.dismissHosted(item)
    }
}
