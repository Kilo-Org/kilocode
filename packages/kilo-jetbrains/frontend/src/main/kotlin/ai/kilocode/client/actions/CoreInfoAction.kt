package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class CoreInfoAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) = Unit

    override fun update(e: AnActionEvent) {
        val app = service<KiloAppService>()
        val info = app.core
        if (info == null) app.fetchCoreInfoAsync()
        e.presentation.text = info?.let {
            KiloBundle.message("action.Kilo.CoreInfo.text", it.version, it.platform)
        } ?: KiloBundle.message("action.Kilo.CoreInfo.loading")
        e.presentation.description = KiloBundle.message("action.Kilo.CoreInfo.description")
        e.presentation.isEnabled = false
        e.presentation.isVisible = true
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
