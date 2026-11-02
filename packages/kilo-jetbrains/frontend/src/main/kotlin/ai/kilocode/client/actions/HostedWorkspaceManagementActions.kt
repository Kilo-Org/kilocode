package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerPanel
import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

abstract class HostedWorkspaceAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    protected fun panel(e: AnActionEvent): AgentManagerPanel? =
        e.getData(SidePanelKeys.WORKTREE_PANEL) as? AgentManagerPanel

    protected fun hosted(e: AnActionEvent): KiloHostedService? =
        e.project?.service<KiloHostedService>()

    protected fun anchor(e: AnActionEvent): java.awt.Component? =
        e.inputEvent?.component ?: panel(e)?.component
}

class HostedAddWorkspaceAction : HostedWorkspaceAction() {
    init {
        templatePresentation.text = KiloBundle.message("action.Kilo.HostedWorkspace.AddExisting.text")
        templatePresentation.description = KiloBundle.message("action.Kilo.HostedWorkspace.AddExisting.description")
        templatePresentation.icon = KiloActionIcons.add
    }

    override fun update(e: AnActionEvent) {
        val hosted = hosted(e)
        if (hosted == null) {
            e.presentation.isEnabledAndVisible = false
            return
        }
        e.presentation.isVisible = hosted.enabled() &&
            e.getData(SidePanelKeys.MODE) == SidePanelMode.AGENT_MANAGER
        e.presentation.isEnabled = e.presentation.isVisible &&
            hosted.state.value.items.isNotEmpty() && panel(e) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val anchor = anchor(e) ?: return
        panel.addExistingHosted(anchor)
    }
}

class HostedCreateWorkspaceAction : HostedWorkspaceAction() {
    init {
        templatePresentation.text = KiloBundle.message("action.Kilo.HostedWorkspace.Create.text")
        templatePresentation.description = KiloBundle.message("action.Kilo.HostedWorkspace.Create.description")
        templatePresentation.icon = KiloActionIcons.add
    }

    override fun update(e: AnActionEvent) {
        val hosted = hosted(e)
        if (hosted == null) {
            e.presentation.isEnabledAndVisible = false
            return
        }
        e.presentation.isVisible = hosted.enabled() &&
            e.getData(SidePanelKeys.MODE) == SidePanelMode.AGENT_MANAGER
        e.presentation.isEnabled = e.presentation.isVisible &&
            !hosted.state.value.repositoryUrl.isNullOrBlank() && panel(e) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val anchor = anchor(e) ?: return
        panel.createHosted(anchor)
    }
}

class HostedRemoveWorkspaceAction : HostedWorkspaceAction() {
    override fun update(e: AnActionEvent) {
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE)
        e.presentation.isVisible = item != null
        e.presentation.isEnabled = item != null
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
        e.presentation.isVisible = item != null
        e.presentation.isEnabled = item != null
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
        e.presentation.isVisible = item?.deletionState == "deleted"
        e.presentation.isEnabled = item?.deletionState == "deleted"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val panel = panel(e) ?: return
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return
        panel.dismissHosted(item)
    }
}
