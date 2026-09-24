package ai.kilocode.client.settings.checkpoints

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.RetentionPatchDto

internal data class CheckpointsDraft(
    val snapshot: Boolean = true,
    val cleanup: Boolean = false,
    val days: Int = 30,
)

/** Snapshots are enabled unless config explicitly opts out, matching the CLI and VS Code. */
internal fun checkpointsDraft(effective: ConfigDto?, global: ConfigDto? = effective): CheckpointsDraft = CheckpointsDraft(
    snapshot = effective?.snapshot ?: true,
    cleanup = global?.retention?.enabled == true,
    days = global?.retention?.maxAgeDays?.takeIf { it >= 1 } ?: 30,
)

internal data class CheckpointsChange(
    val snapshot: Boolean? = null,
    val retention: RetentionPatchDto? = null,
)

internal fun patch(from: CheckpointsDraft, to: CheckpointsDraft): CheckpointsChange? {
    val snapshot = to.snapshot.takeIf { from.snapshot != to.snapshot }
    val retention = if (from.cleanup != to.cleanup || from.days != to.days) {
        RetentionPatchDto(enabled = to.cleanup, maxAgeDays = to.days)
    } else null
    if (snapshot == null && retention == null) return null
    return CheckpointsChange(snapshot, retention)
}

internal fun savedMatches(base: CheckpointsDraft, draft: CheckpointsDraft): Boolean =
    base == draft
