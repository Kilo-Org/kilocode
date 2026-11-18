package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerAvailability
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerKeys
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
        val facade = e.getData(AgentManagerKeys.FACADE)
        val element = e.getData(AgentManagerKeys.ELEMENT)
        val state = element?.let { facade?.availability(it, AgentManagerCommand.MOVE) } ?: AgentManagerAvailability.HIDDEN
        e.presentation.isVisible = state.visible
        e.presentation.isEnabled = state.enabled
    }

    @RequiresEdt
    override fun getChildren(e: AnActionEvent?): Array<AnAction> {
        val facade = e?.getData(AgentManagerKeys.FACADE) ?: return emptyArray()
        val element = e.getData(AgentManagerKeys.ELEMENT) ?: return emptyArray()
        if (!facade.availability(element, AgentManagerCommand.MOVE).enabled) return emptyArray()
        return facade.destinations(element).map { section ->
            object : DumbAwareAction(section.title, null, ActiveTreeColors.icon(section.color)) {
                override fun getActionUpdateThread() = ActionUpdateThread.EDT

                @RequiresEdt
                override fun update(e: AnActionEvent) {
                    val state = facade.availability(element, AgentManagerCommand.MOVE)
                    val current = facade.destinations(element).firstOrNull { it.key == section.key }
                    e.presentation.isVisible = state.visible && current != null
                    e.presentation.isEnabled = state.enabled && current?.enabled == true
                    if (current != null) {
                        e.presentation.text = current.title
                        e.presentation.icon = ActiveTreeColors.icon(current.color)
                    }
                }

                @RequiresEdt
                override fun actionPerformed(e: AnActionEvent) {
                    if (!facade.availability(element, AgentManagerCommand.MOVE).enabled) return
                    if (facade.destinations(element).none { it.key == section.key && it.enabled }) return
                    facade.perform(element, AgentManagerCommand.MOVE, section.key)
                }
            }
        }.toTypedArray()
    }
}
