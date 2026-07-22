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
)

@Serializable
data class WorktreeListDto(val worktrees: List<WorktreeDto> = emptyList())

@Serializable
data class WorktreeBranchesDto(
    val branches: List<String> = emptyList(),
    val current: String? = null,
)

@Serializable
data class CreateWorktreeRequestDto(
    val branch: String,
    val baseBranch: String? = null,
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
