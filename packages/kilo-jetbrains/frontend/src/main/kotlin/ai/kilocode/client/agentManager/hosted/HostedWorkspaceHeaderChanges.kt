package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeStatsDto

internal data class HostedWorkspaceHeaderChanges(
    val stats: WorktreeStatsDto,
    val dirty: WorktreeDirtyDto,
)

/** Projects the passive saved snapshot into the same header model local worktrees use. */
internal fun HostedWorkspaceChangesDto.headerChanges(): HostedWorkspaceHeaderChanges? {
    if (status != "captured") return null
    val groups = comparisons.orEmpty()
    val committed = groups.flatMap { it.files }.filter { it.scope == "against-base-branch" }
    val local = groups.flatMap { it.files }.filter { it.scope == "uncommitted" }
    val bases = groups.filter { group -> group.files.any { it.scope == "against-base-branch" } }
        .map { it.comparison.baseRef }.distinct()
    return HostedWorkspaceHeaderChanges(
        stats = WorktreeStatsDto(ref.key, committed.additions(), committed.deletions(), files = committed.size,
            base = bases.singleOrNull().orEmpty()),
        dirty = WorktreeDirtyDto(ref.key, local.additions(), local.deletions(), files = local.size,
            untracked = local.count { !it.tracked }),
    )
}

private fun List<HostedWorkspaceChangeFileDto>.additions(): Int = sum { it.additions }
private fun List<HostedWorkspaceChangeFileDto>.deletions(): Int = sum { it.deletions }

private fun List<HostedWorkspaceChangeFileDto>.sum(value: (HostedWorkspaceChangeFileDto) -> Long): Int =
    fold(0L) { sum, file ->
        val next = value(file)
        if (sum >= Int.MAX_VALUE - next) Int.MAX_VALUE.toLong() else sum + next
    }.toInt()
