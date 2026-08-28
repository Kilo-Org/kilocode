package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAware

/**
 * `+` toolbar action shown in Agent Manager mode. Opens the New Worktree dialog (New + Import tabs).
 */
class NewWorktreeAction : AnAction(
    KiloBundle.message("action.Kilo.NewWorktree.text"),
    KiloBundle.message("action.Kilo.NewWorktree.description"),
    KiloActionIcons.add,
), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = e.getData(SidePanelKeys.MODE) == SidePanelMode.AGENT_MANAGER
        e.presentation.isEnabled = e.getData(SidePanelKeys.WORKTREE_PANEL) != null
        e.presentation.icon = KiloActionIcons.add
        if (!e.isFromActionToolbar) return
        e.presentation.text = KiloBundle.message("action.Kilo.NewWorktree.toolbar")
        e.presentation.putClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR, true)
    }

    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("New Worktree Clicked", mapOf("surface" to "tool_window"))
        e.getData(SidePanelKeys.WORKTREE_PANEL)?.configure()
    }
}
