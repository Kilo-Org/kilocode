package ai.kilocode.rpc

import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Workspace-level RPC API exposed from backend to frontend.
 *
 * Operations are scoped to a specific directory (workspace root
 * or worktree). Each call routes to a [KiloBackendWorkspace]
 * via the workspace manager.
 */
@Rpc
interface KiloProjectRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloProjectRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloProjectRpcApi>())
        }
    }

    /** Observe workspace state loading progress. */
    suspend fun state(directory: String): Flow<KiloWorkspaceStateDto>

    /** Trigger a full reload of workspace data. */
    suspend fun reload(directory: String)
}
