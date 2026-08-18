package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionGroupUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.popup.JBPopupFactory
import kotlinx.coroutines.Job

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

        internal fun popupGroup(group: ActionGroup): ActionGroup {
            return ActionGroupUtil.forceRecursiveUpdateInBackground(group)
        }

        internal fun refreshConfigTargets(e: AnActionEvent, service: KiloWorkspaceService): List<Job> {
            return listOfNotNull(
                e.workspaceDirectory()?.let { service.refreshLocalConfigTarget(it) },
                service.refreshGlobalConfigTarget(),
            )
        }
    }

    override fun actionPerformed(e: AnActionEvent) {
        val component = e.inputEvent?.component ?: return
        val group = ActionManager.getInstance().getAction(GROUP_ID) as? ActionGroup ?: return
        val service = service<KiloWorkspaceService>()
        refreshConfigTargets(e, service)
        Telemetry.send("Settings Opened", mapOf("surface" to "tool_window"))

        JBPopupFactory.getInstance()
            .createActionGroupPopup(
                null,
                popupGroup(group),
                e.dataContext,
                JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
                true,
            )
            .showUnderneathOf(component)
    }

}
