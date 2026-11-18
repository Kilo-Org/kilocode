package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.agentManager.hosted.HostedPullRequestService
import ai.kilocode.client.agentManager.hosted.reloadHostedWorkspace
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.AnActionEvent

class ReloadHostedWorkspaceAction : HostedWorkspaceAction() {
    override fun update(e: AnActionEvent) {
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE)
        val pending = item?.ref?.workspaceID?.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX) == true
        val hosted = e.project?.getService(KiloHostedService::class.java)
        val available = item != null && !pending && item.deletionState != "deleted" && hosted?.enabled() == true &&
            !hosted.reloading(item.ref)
        e.presentation.isVisible = available
        e.presentation.isEnabled = available
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val item = e.getData(HostedWorkspaceDataKeys.WORKSPACE) ?: return
        if (item.ref.workspaceID.startsWith(HostedWorkspaceEditorKind.PENDING_PREFIX)) return
        if (item.deletionState == "deleted" || !project.getService(KiloHostedService::class.java).enabled()) return
        Telemetry.send("Cloud Workspace Reloaded", mapOf("surface" to "workspace_row"))
        reloadHostedWorkspace(project, item)
        project.getService(HostedPullRequestService::class.java).refresh(item.ref, revalidate = true)
    }
}
