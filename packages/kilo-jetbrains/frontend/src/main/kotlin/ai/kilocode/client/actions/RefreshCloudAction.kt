package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class RefreshCloudAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val dir = e.workspaceDirectory() ?: return
        Telemetry.send("Cloud Refresh Clicked", mapOf("surface" to "menu"))
        project.service<KiloHostedService>().refresh(dir)
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && e.workspaceDirectory() != null
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}
