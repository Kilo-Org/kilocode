package ai.kilocode.client.settings.checkpoints

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto

internal data class CheckpointsDraft(
    val enabled: Boolean = true,
)

/** Snapshots are enabled unless config explicitly opts out, matching the CLI and VS Code. */
internal fun checkpointsDraft(config: ConfigDto?): CheckpointsDraft = CheckpointsDraft(
    enabled = config?.snapshot ?: true,
)

/** Always writes an explicit boolean so disabling snapshots survives the default-on resolution. */
internal fun patch(from: CheckpointsDraft, to: CheckpointsDraft): ConfigPatchDto? {
    if (from.enabled == to.enabled) return null
    return ConfigPatchDto(snapshot = to.enabled)
}

internal fun savedMatches(base: CheckpointsDraft, draft: CheckpointsDraft): Boolean =
    base.enabled == draft.enabled
