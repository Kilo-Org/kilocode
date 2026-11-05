package ai.kilocode.rpc

import ai.kilocode.rpc.dto.RepoAddResultDto
import ai.kilocode.rpc.dto.RepoListDto
import com.intellij.platform.project.ProjectId
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

/**
 * Repository-catalog RPC exposed from backend to frontend.
 *
 * The catalog is keyed by the **pinned workspace** — the repository the open IDE project resolves to.
 * Opening an unrelated project does not see another workspace's added repositories. Every method that
 * needs the IDE project (inference) takes the `projectId` + `directory` pair, mirroring
 * [KiloWorkspaceRpcApi.resolveProjectDirectory].
 *
 * This API only lists and edits the catalog. Every worktree/workspace operation is already
 * directory-scoped ([KiloWorktreeRpcApi], [KiloWorkspaceRpcApi]), so a frontend operates on a listed
 * repo simply by passing its [ai.kilocode.rpc.dto.RepoDto.root] as the `directory`.
 */
@Rpc
interface KiloRepoRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloRepoRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloRepoRpcApi>())
        }
    }

    /** List pinned, added, and inferred repos for the workspace of [directory]. */
    suspend fun list(projectId: ProjectId?, directory: String): RepoListDto

    /**
     * As [list], but re-resolves repository roots first, so a repository that was just `git init`-ed
     * or adopted as a VCS root appears without waiting for the root cache to expire.
     */
    suspend fun refresh(projectId: ProjectId?, directory: String): RepoListDto

    /**
     * Validate [path] as a git repository and register it for the workspace of [directory].
     *
     * Rejects a path that is not a directory, not a git repository, resolves to the pinned project, is
     * under a Kilo-managed worktree, or is already registered. A path already registered (including a
     * linked worktree of an added repo) is returned as success with the existing [RepoDto], not an error.
     */
    suspend fun add(directory: String, path: String, label: String? = null): RepoAddResultDto

    /**
     * Remove a repo from the workspace of [directory]. An added repo is forgotten; an inferred repo is
     * dismissed so it stays hidden until re-added. The pinned project cannot be removed. Returns the
     * refreshed list.
     */
    suspend fun remove(projectId: ProjectId?, directory: String, repoId: String): RepoListDto

    /**
     * Canonical owning repository root for any directory, or null when it is not inside a git repo.
     * The one primitive a caller needs to route a directory (or a worktree of it) to its repository.
     */
    suspend fun resolve(directory: String): String?

    /** Whether inferred nested repositories (submodules, vendored checkouts) are shown and auto-added. */
    suspend fun includeNested(): Boolean

    /** Persist the nested-repository setting. */
    suspend fun setIncludeNested(value: Boolean)
}
