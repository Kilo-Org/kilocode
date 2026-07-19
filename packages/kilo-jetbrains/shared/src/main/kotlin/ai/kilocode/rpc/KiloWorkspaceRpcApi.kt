package ai.kilocode.rpc

import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.platform.project.ProjectId
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
     * [projectId] identifies the exact calling frontend project across the
     * frontend/backend boundary. [hint] is the frontend's project path and is
     * used as a fallback if the project cannot be resolved on the backend.
     */
    suspend fun resolveProjectDirectory(projectId: ProjectId?, hint: String): String

    /** Observe workspace state loading progress. */
    suspend fun state(directory: String): Flow<KiloWorkspaceStateDto>

    /** Trigger a full reload of workspace data. */
    suspend fun reload(directory: String)

    /** Fetch only the providers and agents needed by Models settings. */
    suspend fun models(directory: String): ModelsWorkspaceDto

    /** Resolve [path] to matching files, scoped primarily to [directory]. */
    suspend fun files(directory: String, path: String): List<WorkspaceFileDto>

    /** Fuzzy file/folder search via the backend IDE index. */
    suspend fun searchFiles(directory: String, query: String, limit: Int = 50): FileSearchResultDto

    /** Current uncommitted git changes as a unified diff for @git-changes mentions. */
    suspend fun gitChanges(directory: String): String?

    /** Open an absolute backend file path in the IDE. */
    suspend fun openFile(path: String, line: Int? = null, column: Int? = null): Boolean

    /** Resolve the editable local config target. */
    suspend fun localConfigTarget(directory: String): ConfigTargetDto

    /** Resolve the editable global config target. */
    suspend fun globalConfigTarget(): ConfigTargetDto

    /** Refresh local and global config files after external CLI writes. */
    suspend fun refreshConfigFiles(directory: String)

    /** Open or create the local config file in the IDE. */
    suspend fun openLocalConfig(directory: String): Boolean

    /** Open or create the global config file in the IDE. */
    suspend fun openGlobalConfig(): Boolean
}
