package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerAvailability
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.util.concurrency.annotations.RequiresEdt

abstract class AgentManagerAction(
    private val command: AgentManagerCommand,
    text: String? = null,
    description: String? = null,
) : AnAction(text, description, null), DumbAware {
    final override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    @RequiresEdt
    final override fun update(e: AnActionEvent) {
        val facade = e.getData(AgentManagerKeys.FACADE)
        val element = e.getData(AgentManagerKeys.ELEMENT)
        val state = element?.let { facade?.availability(it, command) } ?: AgentManagerAvailability.HIDDEN
        e.presentation.isVisible = state.visible
        e.presentation.isEnabled = state.enabled
    }

    @RequiresEdt
    final override fun actionPerformed(e: AnActionEvent) {
        val facade = e.getData(AgentManagerKeys.FACADE) ?: return
        val element = e.getData(AgentManagerKeys.ELEMENT) ?: return
        if (!facade.availability(element, command).enabled) return
        facade.perform(element, command)
    }
}
