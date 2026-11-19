package ai.kilocode.client.actions

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.CoreReloadResult
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project

class ReloadCoreSettingsAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val dir = e.workspaceDirectory() ?: return
        reloadCoreSettings(service(), dir, e.project, "menu")
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.workspaceDirectory() != null
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

internal fun reloadCoreSettings(
    service: KiloWorkspaceService,
    directory: String,
    project: Project?,
    surface: String,
) {
    Telemetry.send("Core Settings Reload Clicked", mapOf("surface" to surface))
    service.reloadCoreSettings(directory) { result ->
        when (result) {
            CoreReloadResult.SUCCESS -> Unit
            CoreReloadResult.BUSY -> KiloNotifications.warning(
                project,
                KiloBundle.message("action.Kilo.ReloadCoreSettings.busy"),
            )
            CoreReloadResult.FAILED -> KiloNotifications.error(
                project,
                KiloBundle.message("action.Kilo.ReloadCoreSettings.failed"),
            )
        }
    }
}
