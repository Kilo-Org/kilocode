package ai.kilocode.rpc

import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Git-worktree RPC API exposed from backend to frontend.
 *
 * Operations are scoped to a repository [directory]. The backend runs git
 * as a subprocess (see the workspace RPC's `runWorkspaceGit`) — no bundled
 * git plugin dependency is required.
 */
@Rpc
interface KiloWorktreeRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloWorktreeRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloWorktreeRpcApi>())
    }

    suspend fun list(directory: String): WorktreeListDto

    /**
     * Opens the worktree [directory] as a project in a new IDE frame. Runs on the backend/host so it
     * works in remote development, where the frontend is a JetBrains Client that cannot open local
     * projects. Returns true when a project was opened or was already open.
     */
    suspend fun open(directory: String): Boolean

    suspend fun stats(directory: String): WorktreeStatsListDto

    /**
     * Uncommitted changes per managed worktree, vs each worktree's own HEAD. Separate from [stats]
     * because the baseline differs (HEAD vs the base branch) and because it changes on every file
     * save, so callers may refresh it independently.
     */
    suspend fun dirty(directory: String): WorktreeDirtyListDto
    /**
     * Resolves gh/git availability for [directory]. When [github] is false, resolves git state
     * only ([GhAvailability.GIT_MISSING] or [GhAvailability.OK]) and never spawns `gh`.
     *
     * [maxAge] is the oldest cached answer the caller accepts, in milliseconds; null takes whatever
     * the backend's own TTL allows. See [prStatus] for why callers state an age instead of a flag.
     */
    suspend fun ghStatus(directory: String, github: Boolean = true, maxAge: Long? = null): GhAvailability

    /**
     * Pull-request state per managed worktree. Answers from a short-lived backend cache so a poll
     * and several panels can share one `gh` fan-out.
     *
     * [maxAge] caps how old that cached answer may be, in milliseconds; null accepts the backend's
     * full TTL and 0 forces a fresh lookup. An age rather than a `fresh` flag because it composes:
     * a caller returning from a long absence can ask for `maxAge = <time away>`, which keeps
     * anything gathered while it was gone and rejects only what predates its departure, and several
     * callers asking at once still collapse onto one lookup instead of each forcing its own.
     */
    suspend fun prStatus(directory: String, maxAge: Long? = null): WorktreePrListDto

    /**
     * Single-directory branch status for the chat branch/PR dock: current branch, worktree flag,
     * gh availability, and the PR for the branch (if any). Cached with the same TTL as [prStatus],
     * and [maxAge] caps it the same way. When [github] is false, resolves git state only and returns
     * a null PR without spawning `gh`.
     */
    suspend fun branchStatus(directory: String, github: Boolean = true, maxAge: Long? = null): BranchStatusDto

    /**
     * Moves the session [sessionId] running in [directory] into a fresh worktree on [branch]:
     * captures uncommitted changes, creates the worktree at the source HEAD, transfers the changes,
     * then forks the session into it. When [sessionId] is null, only the working-tree changes are
     * transferred and no FORKING stage is emitted. [branch] is generated on the frontend from the
     * known branch list.
     */
    suspend fun moveToWorktree(directory: String, sessionId: String?, branch: String): Flow<MoveProgressDto>
    suspend fun listBranches(directory: String): WorktreeBranchesDto
    suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto

    /**
     * Imports a worktree from a GitHub pull request [url]. Resolves the PR's head branch via `gh`,
     * fetches it, records the branch's remote and merge ref so the PR stays identifiable, then
     * checks it out into a new worktree. Fork PRs are fetched through `refs/pull/<number>/head` and
     * get an owner-prefixed local branch; no fork remote is added.
     */
    suspend fun importPr(directory: String, url: String): CreateWorktreeResultDto

    suspend fun remove(directory: String, path: String, branch: String? = null, force: Boolean = false): RemoveWorktreeResultDto
    suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto

    /**
     * Sets the worktree's stored display name to [name] only when it still has the default name
     * (no custom name recorded yet). Used to let the first agent-generated session title flow onto
     * the worktree header without ever overriding a name the user chose.
     *
     * Returns the updated worktree when the name was adopted, or a result with a null worktree and
     * null error when it was skipped because a custom name already exists.
     */
    suspend fun adopt(directory: String, path: String, name: String): RenameWorktreeResultDto

    /**
     * Records [paths] as the worktree display order for [directory], reconciled against
     * `git worktree list` (unknown paths dropped, missing ones appended). Returns true when written.
     */
    suspend fun reorder(directory: String, paths: List<String>): Boolean

    /**
     * Returns the persisted session-list visibility for [directory], or null when the user has not
     * chosen a value yet.
     */
    suspend fun sessionList(directory: String): Boolean?

    /** Records the session-list visibility for [directory]. Returns true when written. */
    suspend fun setSessionList(directory: String, visible: Boolean): Boolean
}
