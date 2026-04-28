package ai.kilocode.client.actions

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.popup.JBPopupFactory

/**
 * Gear icon action placed in the Kilo tool window title bar.
 *
 * Looks up [Kilo.SettingsGroup] from [ActionManager] and shows it
 * as a popup. The group composition is declared in
 * `kilo.jetbrains.frontend.xml`.
 */
class KiloSettingsAction : AnAction() {

    companion object {
        const val GROUP_ID = "Kilo.SettingsGroup"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val component = e.inputEvent?.component ?: return
        val group = ActionManager.getInstance().getAction(GROUP_ID) as? ActionGroup ?: return

        JBPopupFactory.getInstance()
            .createActionGroupPopup(
                null,
                group,
                e.dataContext,
                JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
                true,   // showDisabledActions — StatusInfoAction is always disabled
            )
            .showUnderneathOf(component)
    }
}
