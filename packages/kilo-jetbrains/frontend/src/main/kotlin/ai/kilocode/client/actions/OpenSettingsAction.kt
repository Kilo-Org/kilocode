package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.KiloSettingsConfigurable
import ai.kilocode.client.settings.KiloSettingsSelection
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.ProjectManager
import java.util.function.Predicate

class OpenSettingsAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.OpenSettings.text"),
    KiloBundle.message("action.Kilo.OpenSettings.description"),
    null,
) {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Settings Opened", mapOf("surface" to "tool_window"))
        val project = e.project ?: ProjectManager.getInstance().defaultProject
        val target = KiloSettingsSelection.target(project)
        val util = ShowSettingsUtil.getInstance()
        try {
            util.showSettingsDialog(project, predicate(target), null)
        } catch (err: IllegalStateException) {
            if (target == KiloSettingsConfigurable.ID) throw err
            util.showSettingsDialog(project, predicate(KiloSettingsConfigurable.ID), null)
        }
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    private fun predicate(id: String) = Predicate { cfg: Configurable ->
        cfg is ConfigurableWithId && cfg.getId() == id
    }
}
