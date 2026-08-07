package ai.kilocode.rpc

import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

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
    suspend fun stats(directory: String): WorktreeStatsListDto
    suspend fun prStatus(directory: String): WorktreePrListDto
    suspend fun listBranches(directory: String): WorktreeBranchesDto
    suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto
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
}
