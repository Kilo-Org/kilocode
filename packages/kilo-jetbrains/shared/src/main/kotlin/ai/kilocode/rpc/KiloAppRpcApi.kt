package ai.kilocode.rpc

import ai.kilocode.rpc.dto.HealthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * App-level RPC API exposed from backend to frontend.
 *
 * All operations are project-neutral — the CLI backend runs once
 * per application, not per project.
 */
@Rpc
interface KiloAppRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloAppRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloAppRpcApi>())
        }
    }

    /** Ensure the CLI backend is running and connected. */
    suspend fun connect()

    /** Observe app lifecycle state changes. */
    suspend fun state(): Flow<KiloAppStateDto>

    /** One-shot health check against /global/health. */
    suspend fun health(): HealthDto

    /** Retry app connection or loading after a failure. */
    suspend fun retry()

    /** Kill the CLI process and restart it. */
    suspend fun restart()

    /** Kill the CLI process, re-extract the binary, and restart. */
    suspend fun reinstall()
}
