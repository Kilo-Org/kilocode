package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class WorktreeDto(
    val id: String,      // stable key = absolute path
    val name: String,    // display name (last path segment)
    val branch: String,  // "feature/x" or "(detached)"
    val path: String,    // absolute worktree path
    val main: Boolean = false,     // primary working tree — not deletable
    val locked: Boolean = false,   // git worktree lock — blocks a plain remove
    val lockReason: String? = null, // optional reason recorded when the tree was locked
    val prunable: Boolean = false, // git marks metadata stale because the directory is gone
)

@Serializable
data class WorktreeListDto(val worktrees: List<WorktreeDto> = emptyList())

@Serializable
data class WorktreeStatsDto(
    val path: String,
    val additions: Int = 0,
    val deletions: Int = 0,
    val ahead: Int = 0,
    val behind: Int = 0,
    val files: Int = 0,
)

@Serializable
data class WorktreeStatsListDto(val items: List<WorktreeStatsDto> = emptyList())

@Serializable
enum class GhState { OPEN, DRAFT, MERGED, CLOSED }

@Serializable
data class WorktreePrDto(
    val path: String,
    val number: Int,
    val state: GhState,
    val url: String,
    val title: String = "",
)

@Serializable
enum class GhAvailability { OK, MISSING, UNAUTH, GIT_MISSING }

@Serializable
data class WorktreePrListDto(
    val availability: GhAvailability = GhAvailability.OK,
    val items: List<WorktreePrDto> = emptyList(),
)

/**
 * Single-directory branch status for the chat branch/PR dock: the current branch, whether the
 * directory is a linked worktree, gh availability, and the PR for the branch (if any).
 */
@Serializable
data class BranchStatusDto(
    val branch: String = "",
    val worktree: Boolean = false,
    val availability: GhAvailability = GhAvailability.OK,
    val pr: WorktreePrDto? = null,
)

/** Stages of the "Move to Worktree" flow. Mirrors VS Code's ContinueInWorktreeStatus minus setup. */
@Serializable
enum class MoveStage { CAPTURING, CREATING, TRANSFERRING, FORKING, DONE, ERROR }

/** Progress event streamed while moving a session into a new worktree. */
@Serializable
data class MoveProgressDto(
    val stage: MoveStage,
    val error: String? = null,
    val worktree: WorktreeDto? = null,
    val session: String? = null,
)

@Serializable
data class WorktreeBranchesDto(
    val branches: List<String> = emptyList(),
    val current: String? = null,
)

@Serializable
data class CreateWorktreeRequestDto(
    val branch: String,
    val baseBranch: String? = null,
    // When true, check out an existing branch (`git worktree add <dir> <branch>`) instead of creating
    // a new one (`-b`). Used by the Import tab to adopt an existing local/remote branch.
    val existingBranch: Boolean = false,
)

@Serializable
data class CreateWorktreeResultDto(
    val worktree: WorktreeDto? = null,
    val error: String? = null,
)

@Serializable
data class RemoveWorktreeResultDto(
    val ok: Boolean = false,
    val error: String? = null,
    val locked: Boolean = false, // removal was blocked by a worktree lock; retry with force
)

@Serializable
data class RenameWorktreeResultDto(
    val worktree: WorktreeDto? = null,
    val error: String? = null,
)
