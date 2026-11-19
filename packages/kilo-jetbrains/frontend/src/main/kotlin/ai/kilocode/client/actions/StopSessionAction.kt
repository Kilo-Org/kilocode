package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction

class StopSessionAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.StopSession.text"),
    KiloBundle.message("action.Kilo.StopSession.description"),
    null,
) {
    companion object {
        const val ID = "Kilo.StopSession"
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND)
        e.presentation.isEnabled = ctx != null && ctx.isStopEnabled
    }

    override fun actionPerformed(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND) ?: return
        if (!ctx.isStopEnabled) return
        ctx.stop()
    }
}
