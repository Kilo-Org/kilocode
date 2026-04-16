package ai.kilocode.rpc

import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * Session management RPC API exposed from backend to frontend.
 *
 * App-scoped — manages sessions across all directories (workspace
 * roots and worktrees). Each call takes a [directory] parameter to
 * scope the operation, matching the CLI server's directory-based
 * routing.
 */
@Rpc
interface KiloSessionRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloSessionRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloSessionRpcApi>())
        }
    }

    /** List root sessions for a directory. */
    suspend fun list(directory: String): SessionListDto

    /** Create a new session in the given directory. */
    suspend fun create(directory: String): SessionDto

    /** Get a single session by ID. */
    suspend fun get(id: String, directory: String): SessionDto

    /** Delete a session. */
    suspend fun delete(id: String, directory: String)

    /** Observe live session status changes. */
    suspend fun statuses(): Flow<Map<String, SessionStatusDto>>

    /** Register a worktree directory override for a session. */
    suspend fun setDirectory(id: String, directory: String)

    /** Get the effective directory for a session (worktree or fallback). */
    suspend fun getDirectory(id: String, fallback: String): String
}
