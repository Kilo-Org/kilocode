package ai.kilocode.client.actions

import ai.kilocode.client.settings.LogsConfigurationDialog
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction

class LogsConfigurationAction : DumbAwareAction() {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Logs Configuration Opened")
        LogsConfigurationDialog().show()
    }
}
