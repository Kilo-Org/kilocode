package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.worktree.SidePanelKeys
import ai.kilocode.client.worktree.SidePanelMode
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

class NewWorktreeAction : AnAction(
    KiloBundle.message("action.Kilo.NewWorktree.text"),
    KiloBundle.message("action.Kilo.NewWorktree.description"),
    AllIcons.General.Add,
), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("New Worktree Clicked", mapOf("surface" to "tool_window"))
        e.getData(SidePanelKeys.WORKTREE_PANEL)?.requestCreate()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isVisible = e.getData(SidePanelKeys.MODE) == SidePanelMode.WORKTREES
        e.presentation.isEnabled = e.getData(SidePanelKeys.WORKTREE_PANEL) != null
    }
}
