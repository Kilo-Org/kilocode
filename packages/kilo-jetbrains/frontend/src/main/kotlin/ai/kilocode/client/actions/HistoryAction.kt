package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.actionSystem.PlatformDataKeys
import com.intellij.openapi.project.DumbAware

class HistoryAction : AnAction(
    KiloBundle.message("action.Kilo.History.text"),
    KiloBundle.message("action.Kilo.History.description"),
    AllIcons.Vcs.History,
), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val manager = e.getData(SessionManager.KEY) ?: return
        Telemetry.send("History Opened", mapOf("surface" to "tool_window"))
        // History renders inside the chat content, which only lives on the AI Chat tab, so bring
        // that tab forward first when invoked from the Agent Manager tab.
        if (e.getData(SidePanelKeys.MODE) == SidePanelMode.AGENT_MANAGER) selectChat(e)
        manager.showHistory()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(SessionManager.KEY) != null
    }

    private fun selectChat(e: AnActionEvent) {
        val manager = e.getData(PlatformDataKeys.TOOL_WINDOW)?.contentManager ?: return
        val chat = manager.contents.firstOrNull {
            (it.component as? DataProvider)?.getData(SidePanelKeys.MODE.name) == SidePanelMode.CHAT
        } ?: return
        manager.setSelectedContent(chat, true)
    }
}
