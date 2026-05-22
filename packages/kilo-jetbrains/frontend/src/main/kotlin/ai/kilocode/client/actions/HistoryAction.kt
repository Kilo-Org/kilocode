package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionManager
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
        e.getData(SessionManager.KEY)?.showHistory()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.getData(SessionManager.KEY) != null
    }
}
