package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.SessionActionsKeys
import ai.kilocode.client.session.settings.CompactModeListener
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware

/**
 * Toggles the transcript's compact mode from the prompt bar's "more" menu.
 *
 * Like auto-approve this is an IDE-level setting stored in `PropertiesComponent`, shared by every
 * Kilo session in this IDE. Which tool categories actually collapse is configured in
 * Settings | Kilo | Advanced; this action is only the master switch.
 */
class SessionCompactModeAction : ToggleAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        super.update(e)
        // Visible for readonly hosts too (subagent tabs): compact mode changes how a transcript
        // reads, not what it can do, so a view-only session benefits from it as much as a live one.
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS) != null
    }

    override fun isSelected(e: AnActionEvent): Boolean = KiloPluginSettings.getCompactMode()

    override fun setSelected(e: AnActionEvent, state: Boolean) {
        KiloPluginSettings.setCompactMode(state)
        ApplicationManager.getApplication().messageBus.syncPublisher(CompactModeListener.TOPIC).changed()
    }
}
