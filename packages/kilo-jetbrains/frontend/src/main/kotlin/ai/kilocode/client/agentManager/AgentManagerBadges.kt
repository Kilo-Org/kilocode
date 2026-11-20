package ai.kilocode.client.agentManager

import ai.kilocode.client.ui.PrBadgeActions
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveMetrics
import ai.kilocode.client.ui.conflicted
import ai.kilocode.client.ui.prGlyphBadges
import ai.kilocode.client.ui.prNumberBadge
import com.intellij.util.concurrency.annotations.RequiresEdt

internal class AgentManagerBadges @RequiresEdt constructor(
    private val facade: AgentManagerFacade,
    private val element: AgentManagerElement,
) {
    val state = facade.badges(element)
    val actions = PrBadgeActions(
        open = action(AgentManagerCommand.PR),
        review = action(AgentManagerCommand.REVIEW),
        checks = action(AgentManagerCommand.CHECKS),
        comments = action(AgentManagerCommand.COMMENTS),
    )
    val primary: List<ActiveBadge> = if (state.busy) emptyList() else prGlyphBadges(state.pr, actions)
    val secondary: List<ActiveBadge> = if (state.busy) emptyList() else listOfNotNull(prNumberBadge(state.pr, actions))
    val metrics: ActiveMetrics? = run {
        val stats = state.stats
        val dirty = state.dirty
        if (state.busy || (stats?.files ?: 0) == 0 && (dirty?.files ?: 0) == 0) return@run null
        ActiveMetrics(
            files = stats?.files ?: 0,
            additions = stats?.additions ?: 0,
            deletions = stats?.deletions ?: 0,
            base = stats?.base.orEmpty(),
            localFiles = dirty?.files ?: 0,
            localAdditions = dirty?.additions ?: 0,
            localDeletions = dirty?.deletions ?: 0,
            conflict = conflicted(state.pr),
            onChanges = action(AgentManagerCommand.BASE_DIFF),
            onLocal = action(AgentManagerCommand.UNCOMMITTED_DIFF),
        )
    }

    @RequiresEdt
    fun action(command: AgentManagerCommand): (() -> Unit)? {
        if (state.busy || command !in state.enabled) return null
        return {
            if (facade.availability(element, command).enabled) facade.perform(element, command)
        }
    }
}
