package ai.kilocode.rpc.dto.orphans

import kotlinx.serialization.Serializable

/**
 * Whether an [OrphanDto] still holds a git checkout ([BROKEN], its `.git` file/dir is still there —
 * likely an interrupted delete) or is a plain [LEFTOVER] directory (hand-removed metadata, a stray
 * `.idea`/`.kilo-dev` directory, etc.). Mirrors VS Code's `worktree-reconcile.ts` classification so
 * both clients agree on which rows are pre-selected for deletion and which are flagged as risky.
 */
@Serializable
enum class OrphanKind { BROKEN, LEFTOVER }

/** One directory under `.kilo/worktrees/` that git does not track. See `WorktreeListDto.orphans`. */
@Serializable
data class OrphanDto(
    val path: String,
    val kind: OrphanKind,
)

@Serializable
data class OrphanRemoveResultDto(
    val path: String,
    val ok: Boolean,
    val error: String? = null,
)

@Serializable
data class RemoveOrphansResultDto(
    val results: List<OrphanRemoveResultDto> = emptyList(),
)
