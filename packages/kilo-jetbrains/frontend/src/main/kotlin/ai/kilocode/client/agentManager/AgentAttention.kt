package ai.kilocode.client.agentManager

import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto

/**
 * Notification dot state for the Agents tab.
 *
 * The dot marks attention the user has not looked at yet. That distinction is what lets it clear for
 * good: an error stays in the activity snapshot until its session runs again, so a dot driven by the
 * snapshot alone would come back every time the user left the tab. A session that stops needing
 * attention is forgotten again, so a later failure lights the dot once more.
 */
internal class AgentAttention {
    private var seen = emptySet<String>()

    /**
     * Whether the dot should be visible. [read] means the user is looking at the Agent Manager,
     * which marks everything currently pending as seen — the rows carry the badge there.
     */
    fun update(activity: Map<String, SessionActivityDto>, read: Boolean): Boolean {
        val pending = activity.filterValues(::attention).keys
        seen = if (read) pending else seen intersect pending
        return (pending - seen).isNotEmpty()
    }
}

/** Whether a session is waiting on the user or has failed. */
private fun attention(item: SessionActivityDto): Boolean =
    item.kind == SessionActivityKindDto.QUESTION ||
        item.kind == SessionActivityKindDto.PLAN ||
        item.kind == SessionActivityKindDto.PERMISSION ||
        item.kind == SessionActivityKindDto.ERROR
