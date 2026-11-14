package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.tree.ActiveTreeColors
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.util.concurrency.annotations.RequiresEdt

class MoveAgentManagerItemGroup : ActionGroup(
    KiloBundle.message("group.Kilo.AgentManager.MoveTo.text"), true,
), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    @RequiresEdt
    override fun update(e: AnActionEvent) {
        val panel = e.getData(SidePanelKeys.WORKTREE_PANEL)
        val key = e.getData(WorktreeDataKeys.WORKTREE)?.id ?: e.getData(HostedWorkspaceDataKeys.WORKSPACE)?.ref?.key
        e.presentation.isEnabledAndVisible = panel?.canMove(key) == true
        if (panel != null) e.presentation.isEnabled = panel.canMove(key) && panel.sections().isNotEmpty()
    }

    @RequiresEdt
    override fun getChildren(e: AnActionEvent?): Array<AnAction> {
        val panel = e?.getData(SidePanelKeys.WORKTREE_PANEL)
        val key = e?.getData(WorktreeDataKeys.WORKTREE)?.id ?: e?.getData(HostedWorkspaceDataKeys.WORKSPACE)?.ref?.key
        if (panel == null || key == null || !panel.canMove(key)) return emptyArray()
        return panel.sections().map { section ->
            object : DumbAwareAction(section.title, null, ActiveTreeColors.icon(section.color)) {
                override fun getActionUpdateThread() = ActionUpdateThread.EDT

                @RequiresEdt
                override fun update(e: AnActionEvent) {
                    e.presentation.isEnabled = panel.canMove(key) && panel.section(key) != section.key &&
                        panel.sections().any { it.key == section.key }
                    e.presentation.icon = ActiveTreeColors.icon(section.color)
                }

                @RequiresEdt
                override fun actionPerformed(e: AnActionEvent) = panel.relocate(key, section.key)
            }
        }.toTypedArray()
    }
}
