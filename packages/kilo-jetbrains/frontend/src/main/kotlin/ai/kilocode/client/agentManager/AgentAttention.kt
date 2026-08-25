package ai.kilocode.client.agentManager

import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto

/**
 * Notification dot state for the Agents tab.
 *
 * The dot marks attention the user has not looked at yet. Sessions that need attention while the
 * Agent Manager is on screen count as seen, because the rows already carry the badge there. That is
 * what lets the dot clear for good: an error stays in the activity snapshot until its session runs
 * again, so a dot driven by the snapshot alone would come back every time the user left the tab.
 * A session that stops needing attention is forgotten again, so a later failure lights the dot.
 */
internal class AgentAttention {
    private var seen = emptySet<String>()

    /** Whether the dot should be visible, where [showing] means the Agent Manager is on screen. */
    fun update(activity: Map<String, SessionActivityDto>, showing: Boolean): Boolean {
        val pending = activity.filterValues(::attention).keys
        seen = if (showing) pending else seen intersect pending
        return (pending - seen).isNotEmpty()
    }
}

/** Whether a session is waiting on the user or has failed. */
private fun attention(item: SessionActivityDto): Boolean =
    item.kind == SessionActivityKindDto.QUESTION ||
        item.kind == SessionActivityKindDto.PLAN ||
        item.kind == SessionActivityKindDto.PERMISSION ||
        item.kind == SessionActivityKindDto.ERROR
