package ai.kilocode.rpc

import ai.kilocode.rpc.dto.ConnectionStateDto
import ai.kilocode.rpc.dto.HealthDto
import com.intellij.platform.project.ProjectId
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Project-scoped RPC API exposed from backend to frontend.
 *
 * Every method takes a [ProjectId] as its first parameter, following the
 * JetBrains modular plugin template pattern. The frontend obtains the ID
 * via `project.projectId()` and the backend resolves the project via
 * `projectId.findProjectOrNull()`.
 */
@Rpc
interface KiloProjectRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloProjectRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloProjectRpcApi>())
        }
    }

    /** Ensure the CLI backend is running and connected. */
    suspend fun connect(projectId: ProjectId)

    /** Observe connection state changes. */
    suspend fun state(projectId: ProjectId): Flow<ConnectionStateDto>

    /** One-shot health check against /global/health. */
    suspend fun health(projectId: ProjectId): HealthDto

    /** Kill the CLI process and restart it. */
    suspend fun restart(projectId: ProjectId)

    /** Kill the CLI process, re-extract the binary, and restart. */
    suspend fun reinstall(projectId: ProjectId)
}
