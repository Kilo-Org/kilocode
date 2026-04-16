@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow

/**
 * Backend implementation of [KiloSessionRpcApi].
 *
 * Session CRUD routes through the [KiloBackendWorkspaceManager] to
 * get the correct workspace for a directory. Status tracking and
 * worktree directory management go directly to the
 * [KiloBackendSessionManager].
 */
class KiloSessionRpcApiImpl : KiloSessionRpcApi {

    private val workspaces: KiloBackendWorkspaceManager
        get() = service<KiloBackendAppService>().workspaces

    private val sessions: KiloBackendSessionManager
        get() = service<KiloBackendAppService>().sessions

    override suspend fun list(directory: String): SessionListDto =
        workspaces.get(directory).sessions()

    override suspend fun create(directory: String): SessionDto =
        workspaces.get(directory).createSession()

    override suspend fun get(id: String, directory: String): SessionDto {
        val dir = sessions.getDirectory(id, directory)
        return sessions.get(id, dir)
    }

    override suspend fun delete(id: String, directory: String) {
        val dir = sessions.getDirectory(id, directory)
        workspaces.get(dir).deleteSession(id)
    }

    override suspend fun statuses(): Flow<Map<String, SessionStatusDto>> =
        sessions.statuses

    override suspend fun setDirectory(id: String, directory: String) =
        sessions.setDirectory(id, directory)

    override suspend fun getDirectory(id: String, fallback: String): String =
        sessions.getDirectory(id, fallback)
}
