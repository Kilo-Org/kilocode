package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/** Where a repository in the list came from. */
@Serializable
enum class RepoSource {
    /** The open IDE project itself. Always first, never removable. */
    PINNED,

    /** Explicitly added by the user through the repo picker. Persisted. */
    ADDED,

    /** Inferred from the IDE's VCS roots (or content roots as a fallback). Recomputed, not persisted. */
    INFERRED,
}

/** Which source the inference actually answered from, so a caller can tell why a repo is missing. */
@Serializable
enum class RepoDiscovery {
    NONE,
    VCS_ROOTS,
    CONTENT_ROOTS,
}

/**
 * One repository as seen by the Agent Manager backend.
 *
 * [id] is a deterministic hash of the canonical main-worktree [root], stable across restarts and
 * across a linked worktree of the same repository. [root] is the canonical main-worktree path.
 */
@Serializable
data class RepoDto(
    val id: String,
    val root: String,
    val name: String,
    val source: RepoSource,
    val label: String? = null,
    /** True when this root sits inside another listed repo's working tree (submodule, vendored checkout). */
    val nested: Boolean = false,
    /** True when the directory no longer exists on disk. Reported, never auto-removed. */
    val missing: Boolean = false,
    val order: Int = 0,
)

/**
 * The repository list for one pinned workspace.
 *
 * [repos] order is pinned first, then added by [RepoDto.order], then inferred alphabetically. [withheld]
 * carries roots discovered but not shown — nested roots while the nested setting is off.
 */
@Serializable
data class RepoListDto(
    val repos: List<RepoDto> = emptyList(),
    val withheld: List<RepoDto> = emptyList(),
    val includeNested: Boolean = false,
    val discovery: RepoDiscovery = RepoDiscovery.NONE,
    val truncated: Boolean = false,
)

/** Result of validating and registering a repository path. Exactly one of [repo] / [error] is set. */
@Serializable
data class RepoAddResultDto(
    val repo: RepoDto? = null,
    val error: String? = null,
)
