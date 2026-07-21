package ai.kilocode.rpc

import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeListDto
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
    suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto
    suspend fun remove(directory: String, path: String, branch: String? = null)
}
