package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto

internal fun aggregateWorktreeActivity(
    activity: Map<String, SessionActivityDto>,
): Map<String, SessionActivityKind> = activity.values
    .groupBy { normalize(it.directory) }
    .mapValues { (_, items) -> items.map { kind(it.kind) }.minBy(::rank) }

internal fun normalizeWorktreePath(path: String): String = normalize(path)

private fun normalize(path: String): String = path.trimEnd('/')

private fun kind(kind: SessionActivityKindDto): SessionActivityKind = when (kind) {
    SessionActivityKindDto.RUNNING -> SessionActivityKind.RUNNING
    SessionActivityKindDto.QUESTION -> SessionActivityKind.QUESTION
    SessionActivityKindDto.PLAN -> SessionActivityKind.PLAN
    SessionActivityKindDto.PERMISSION -> SessionActivityKind.PERMISSION
    SessionActivityKindDto.ERROR -> SessionActivityKind.ERROR
}

/**
 * Precedence for a worktree holding several sessions: anything waiting on the user first, then live
 * work, then a session left in an error. Running beats error so one stopped session cannot hide the
 * spinner of a sibling that is still working.
 */
private fun rank(kind: SessionActivityKind): Int = when (kind) {
    SessionActivityKind.PERMISSION -> 0
    SessionActivityKind.QUESTION -> 1
    SessionActivityKind.PLAN -> 2
    SessionActivityKind.RUNNING -> 3
    SessionActivityKind.ERROR -> 4
    SessionActivityKind.LOGIN_REQUIRED -> 5
}
