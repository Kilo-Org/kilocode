package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class RefreshHostedWorkspaceAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val project = e.project
        if (project == null || e.getData(HostedWorkspaceDataKeys.WORKSPACE) == null) {
            e.presentation.isEnabledAndVisible = false
            return
        }
        val hosted = project.service<KiloHostedService>()
        e.presentation.isVisible = hosted.enabled()
        e.presentation.isEnabled = e.presentation.isVisible && !hosted.state.value.loading
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        if (e.getData(HostedWorkspaceDataKeys.WORKSPACE) == null) return
        val hosted = project.service<KiloHostedService>()
        if (hosted.enabled() && !hosted.state.value.loading) {
            Telemetry.send("Cloud Refresh Clicked", mapOf("surface" to "workspace_row"))
            hosted.refresh(project.basePath.orEmpty())
        }
    }
}
