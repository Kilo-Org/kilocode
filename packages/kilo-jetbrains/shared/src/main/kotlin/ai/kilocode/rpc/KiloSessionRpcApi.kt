package ai.kilocode.rpc

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PromptDto
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

    // ------ chat ------

    /** Send a prompt to a session (fire-and-forget). */
    suspend fun prompt(id: String, directory: String, prompt: PromptDto)

    /** Abort ongoing processing for a session. */
    suspend fun abort(id: String, directory: String)

    /** Load message history for a session. */
    suspend fun messages(id: String, directory: String): List<MessageWithPartsDto>

    /** Subscribe to streaming chat events for a specific session. */
    suspend fun events(id: String, directory: String): Flow<ChatEventDto>

    /** Update config (model, agent/mode, temperature). */
    suspend fun updateConfig(directory: String, config: ConfigUpdateDto)
}
