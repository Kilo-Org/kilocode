package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class RestartKiloAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        service<KiloAppService>().restartAsync()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = true
    }
}
