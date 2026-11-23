package ai.kilocode.client.testing

import ai.kilocode.client.agentManager.AgentManagerAvailability
import ai.kilocode.client.agentManager.AgentManagerBadgeState
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerDestination
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerFacade
import com.intellij.util.concurrency.annotations.RequiresEdt

internal class FakeAgentManagerFacade(
    var state: AgentManagerBadgeState = AgentManagerBadgeState(),
) : AgentManagerFacade {
    data class Call(val element: AgentManagerElement, val command: AgentManagerCommand, val target: String?)

    var enabled = state.enabled
    val overrides = mutableMapOf<AgentManagerCommand, AgentManagerAvailability>()
    var targets = emptyList<AgentManagerDestination>()
    val requests = mutableListOf<AgentManagerElement>()
    val queries = mutableListOf<Pair<AgentManagerElement, AgentManagerCommand>>()
    val calls = mutableListOf<Call>()

    @RequiresEdt
    override fun availability(element: AgentManagerElement, command: AgentManagerCommand): AgentManagerAvailability {
        queries += element to command
        return overrides[command] ?: AgentManagerAvailability.of(command in enabled)
    }

    @RequiresEdt
    override fun perform(element: AgentManagerElement, command: AgentManagerCommand, target: String?) {
        calls += Call(element, command, target)
    }

    @RequiresEdt
    override fun destinations(element: AgentManagerElement): List<AgentManagerDestination> {
        requests += element
        return targets
    }

    @RequiresEdt
    override fun badges(element: AgentManagerElement): AgentManagerBadgeState = state
}
