package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

class HistoryAction : AnAction(
    KiloBundle.message("action.Kilo.History.text"),
    KiloBundle.message("action.Kilo.History.description"),
    AllIcons.Vcs.History,
), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("History Opened", mapOf("surface" to "tool_window"))
        e.getData(SessionManager.KEY)?.showHistory()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = e.getData(SidePanelKeys.MODE) != SidePanelMode.AGENT_MANAGER
        e.presentation.isEnabled = e.getData(SessionManager.KEY) != null
    }
}
