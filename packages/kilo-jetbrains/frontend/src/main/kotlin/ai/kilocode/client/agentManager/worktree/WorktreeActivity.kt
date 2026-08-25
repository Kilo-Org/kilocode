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

private fun rank(kind: SessionActivityKind): Int = when (kind) {
    SessionActivityKind.PERMISSION -> 0
    SessionActivityKind.QUESTION -> 1
    SessionActivityKind.PLAN -> 2
    SessionActivityKind.ERROR -> 3
    SessionActivityKind.RUNNING -> 4
    SessionActivityKind.LOGIN_REQUIRED -> 5
}
