package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction

class ToggleAutoApproveAction : DumbAwareAction(
    KiloBundle.message("action.Kilo.ToggleAutoApprove.text"),
    KiloBundle.message("action.Kilo.ToggleAutoApprove.description"),
    null,
) {
    companion object {
        const val ID = "Kilo.ToggleAutoApprove"
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND)
        e.presentation.isEnabled = ctx != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val ctx = e.getData(PromptDataKeys.SEND) ?: return
        ctx.toggleAutoApprove()
    }
}
