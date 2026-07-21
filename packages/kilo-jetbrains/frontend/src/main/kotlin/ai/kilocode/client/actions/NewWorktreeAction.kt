package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * Chevron "+" toolbar dropdown shown in Agent Manager mode. Opens a menu with a quick "New Worktree
 * from <branch>" create and an advanced "Configure new worktree" dialog.
 */
class NewWorktreeAction : ActionGroup(), DumbAware {
    private val children = arrayOf<AnAction>(QuickWorktreeAction(), ConfigureWorktreeAction())

    init {
        isPopup = true
        templatePresentation.text = KiloBundle.message("action.Kilo.NewWorktree.text")
        templatePresentation.description = KiloBundle.message("action.Kilo.NewWorktree.description")
        templatePresentation.icon = AllIcons.General.Add
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = e.getData(SidePanelKeys.MODE) == SidePanelMode.AGENT_MANAGER
        e.presentation.isEnabled = e.getData(SidePanelKeys.WORKTREE_PANEL) != null
    }

    override fun getChildren(e: AnActionEvent?): Array<AnAction> = children
}

private class QuickWorktreeAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL)
        e.presentation.isEnabledAndVisible = panel != null
        e.presentation.icon = AllIcons.Vcs.Branch
        e.presentation.text = KiloBundle.message("worktree.menu.from", panel?.defaultBranch() ?: "main")
    }

    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("New Worktree Clicked", mapOf("surface" to "tool_window", "mode" to "quick"))
        e.getData(SidePanelKeys.WORKTREE_PANEL)?.quickCreate()
    }
}

private class ConfigureWorktreeAction : AnAction(
    KiloBundle.message("worktree.menu.configure"),
    null,
    AllIcons.General.Settings,
), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SidePanelKeys.WORKTREE_PANEL) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("New Worktree Clicked", mapOf("surface" to "tool_window", "mode" to "configure"))
        e.getData(SidePanelKeys.WORKTREE_PANEL)?.configure()
    }
}
