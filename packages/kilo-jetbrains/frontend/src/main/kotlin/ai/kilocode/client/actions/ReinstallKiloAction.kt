package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class ReinstallKiloAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        service<KiloAppService>().reinstallAsync()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = true
    }
}
