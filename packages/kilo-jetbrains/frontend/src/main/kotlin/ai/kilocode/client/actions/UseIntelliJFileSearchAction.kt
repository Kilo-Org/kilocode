package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloFileSearchSettingsService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareToggleAction

class UseIntelliJFileSearchAction : DumbAwareToggleAction(
    KiloBundle.message("action.Kilo.FileSearch.UseIntelliJ.text"),
    KiloBundle.message("action.Kilo.FileSearch.UseIntelliJ.description"),
    null,
) {
    override fun isSelected(e: AnActionEvent): Boolean {
        return KiloFileSearchSettingsService.getInstance().useIntellij()
    }

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        KiloFileSearchSettingsService.getInstance().setUseIntellij(state)
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
