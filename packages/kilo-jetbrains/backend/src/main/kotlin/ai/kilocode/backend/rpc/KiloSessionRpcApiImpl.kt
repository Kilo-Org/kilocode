@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter

/**
 * Backend implementation of [KiloSessionRpcApi].
 *
 * Session CRUD routes through the [KiloBackendWorkspaceManager] to
 * get the correct workspace for a directory. Status tracking and
 * worktree directory management go directly to the
 * [KiloBackendSessionManager]. Chat operations delegate to
 * [KiloBackendChatManager].
 */
class KiloSessionRpcApiImpl : KiloSessionRpcApi {
    companion object {
        private val LOG = Logger.getInstance(KiloSessionRpcApiImpl::class.java)
    }

    private val workspaces: KiloBackendWorkspaceManager
        get() = service<KiloBackendAppService>().workspaces

    private val sessions: KiloBackendSessionManager
        get() = service<KiloBackendAppService>().sessions

    private val chat: KiloBackendChatManager
        get() = service<KiloBackendAppService>().chat

    override suspend fun list(directory: String): SessionListDto =
        workspaces.get(directory).sessions()

    override suspend fun create(directory: String): SessionDto {
        LOG.info("create session: directory=$directory")
        return workspaces.get(directory).createSession()
    }

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

    // ------ chat ------

    override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
        LOG.info("prompt RPC: session=$id, dir=$directory, parts=${prompt.parts.size}")
        chat.prompt(id, directory, prompt)
    }

    override suspend fun abort(id: String, directory: String) =
        chat.abort(id, directory)

    override suspend fun messages(id: String, directory: String): List<MessageWithPartsDto> =
        chat.messages(id, directory)

    override suspend fun events(id: String, directory: String): Flow<ChatEventDto> =
        chat.events.filter { event ->
            val sid = when (event) {
                is ChatEventDto.MessageUpdated -> event.sessionID
                is ChatEventDto.PartUpdated -> event.sessionID
                is ChatEventDto.PartDelta -> event.sessionID
                is ChatEventDto.TurnOpen -> event.sessionID
                is ChatEventDto.TurnClose -> event.sessionID
                is ChatEventDto.Error -> event.sessionID
                is ChatEventDto.MessageRemoved -> event.sessionID
            }
            sid == id
        }

    override suspend fun updateConfig(directory: String, config: ConfigUpdateDto) =
        chat.updateConfig(directory, config)
}
