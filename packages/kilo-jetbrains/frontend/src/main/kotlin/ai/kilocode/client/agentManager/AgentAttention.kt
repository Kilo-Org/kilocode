package ai.kilocode.client.agentManager

import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto

/**
 * Whether any session in the activity snapshot is waiting on the user or has failed, i.e. the Agents
 * tab should show a notification dot.
 *
 * The dot mirrors that state for as long as it lasts, across every worktree and session. Viewing the
 * tab does not clear it: only resolving the attention does, by answering the prompt or running the
 * session again.
 */
internal fun sessionAttentionNeeded(activity: Map<String, SessionActivityDto>): Boolean =
    activity.values.any {
        it.kind == SessionActivityKindDto.QUESTION ||
            it.kind == SessionActivityKindDto.PLAN ||
            it.kind == SessionActivityKindDto.PERMISSION ||
            it.kind == SessionActivityKindDto.ERROR
    }
