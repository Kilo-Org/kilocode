package ai.kilocode.rpc

import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
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
interface KiloWorkspaceRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloWorkspaceRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloWorkspaceRpcApi>())
        }
    }

    /**
     * Resolve the real project directory as seen by the backend.
     *
     * In split mode, the frontend's [Project.getBasePath] returns a
     * synthetic sandbox path. This method returns the backend's actual
     * project directory so the frontend can use it for CLI server calls.
     */
    suspend fun resolveProjectDirectory(hint: String): String

    /** Observe workspace state loading progress. */
    suspend fun state(directory: String): Flow<KiloWorkspaceStateDto>

    /** Trigger a full reload of workspace data. */
    suspend fun reload(directory: String)

    /** Fetch only the providers and agents needed by Models settings. */
    suspend fun models(directory: String): ModelsWorkspaceDto

    /** Resolve [path] to matching files, scoped primarily to [directory]. */
    suspend fun files(directory: String, path: String): List<WorkspaceFileDto>

    /** Open an absolute backend file path in the IDE. */
    suspend fun openFile(path: String): Boolean

    /** Resolve the editable local config target. */
    suspend fun localConfigTarget(directory: String): ConfigTargetDto

    /** Resolve the editable global config target. */
    suspend fun globalConfigTarget(): ConfigTargetDto

    /** Open or create the local config file in the IDE. */
    suspend fun openLocalConfig(directory: String): Boolean

    /** Open or create the global config file in the IDE. */
    suspend fun openGlobalConfig(): Boolean
}
