package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.HostedWorkspaceChangeFileDto
import ai.kilocode.rpc.dto.HostedWorkspaceChangesDto
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeStatsDto

internal data class HostedWorkspaceHeaderChanges(
    val stats: WorktreeStatsDto,
    val dirty: WorktreeDirtyDto,
)

/**
 * Projects the passive saved snapshot into the same header model local worktrees use.
 *
 * A snapshot that was never captured, or whose capture is inconsistent, is unknown rather than clean.
 * The header keeps both comparison controls but must not claim `0 files` for data that does not exist,
 * so those states carry [WorktreeStatsDto.unavailable] and a reason. Truncated snapshots keep their
 * counts and are marked [WorktreeStatsDto.incomplete] instead.
 */
internal fun HostedWorkspaceChangesDto.headerChanges(): HostedWorkspaceHeaderChanges {
    val missing = when (status) {
        "captured" -> null
        "inconsistent" -> KiloBundle.message("diff.editor.hosted.inconsistent")
        else -> KiloBundle.message("diff.editor.hosted.notCaptured")
    }
    val groups = comparisons.orEmpty()
    val committed = groups.flatMap { it.files }.filter { it.scope == "against-base-branch" }
    val local = groups.flatMap { it.files }.filter { it.scope == "uncommitted" }
    val bases = groups.filter { group -> group.files.any { it.scope == "against-base-branch" } }
        .map { it.comparison.baseRef }.distinct()
    val partial = truncated || groups.any { it.truncated } || (committed + local).any { !it.countsComplete }
    val committedAdditions = committed.additions()
    val committedDeletions = committed.deletions()
    val localAdditions = local.additions()
    val localDeletions = local.deletions()
    return HostedWorkspaceHeaderChanges(
        stats = WorktreeStatsDto(ref.key, committedAdditions, committedDeletions, files = committed.size,
            base = bases.singleOrNull().orEmpty(), unavailable = missing != null, reason = missing.orEmpty(),
            incomplete = missing == null && (partial || committedAdditions == Int.MAX_VALUE ||
                committedDeletions == Int.MAX_VALUE)),
        dirty = WorktreeDirtyDto(ref.key, localAdditions, localDeletions, files = local.size,
            untracked = local.count { !it.tracked }, unavailable = missing != null, reason = missing.orEmpty(),
            incomplete = missing == null && (partial || localAdditions == Int.MAX_VALUE ||
                localDeletions == Int.MAX_VALUE)),
    )
}

private fun List<HostedWorkspaceChangeFileDto>.additions(): Int = sum { it.additions }
private fun List<HostedWorkspaceChangeFileDto>.deletions(): Int = sum { it.deletions }

private fun List<HostedWorkspaceChangeFileDto>.sum(value: (HostedWorkspaceChangeFileDto) -> Long): Int =
    fold(0L) { sum, file ->
        val next = value(file)
        if (sum >= Int.MAX_VALUE - next) Int.MAX_VALUE.toLong() else sum + next
    }.toInt()
