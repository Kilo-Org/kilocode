@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.service
import ai.kilocode.log.KiloLog
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
        private val LOG = KiloLog.create(KiloSessionRpcApiImpl::class.java)
    }

    private val workspaces: KiloBackendWorkspaceManager
        get() = app.workspaces

    private val sessions: KiloBackendSessionManager
        get() = app.sessions

    private val chat: KiloBackendChatManager
        get() = app.chat

    private val app: KiloBackendAppService
        get() = service()

    override suspend fun list(directory: String): SessionListDto =
        ready { workspaces.get(directory).sessions() }

    override suspend fun recent(directory: String, limit: Int): SessionListDto =
        ready { sessions.recent(directory, limit) }

    override suspend fun create(directory: String): SessionDto {
        app.requireReady()
        LOG.info("create session: directory=$directory")
        return workspaces.get(directory).createSession()
    }

    override suspend fun get(id: String, directory: String): SessionDto {
        app.requireReady()
        val dir = sessions.getDirectory(id, directory)
        return sessions.get(id, dir)
    }

    override suspend fun delete(id: String, directory: String) {
        app.requireReady()
        val dir = sessions.getDirectory(id, directory)
        workspaces.get(dir).deleteSession(id)
    }

    override suspend fun rename(id: String, directory: String, title: String): ai.kilocode.rpc.dto.SessionDto {
        app.requireReady()
        val dir = sessions.getDirectory(id, directory)
        return sessions.rename(id, dir, title)
    }

    override suspend fun cloudSessions(directory: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto =
        ready { sessions.cloudSessions(directory, cursor, limit, gitUrl) }

    override suspend fun importCloudSession(id: String, directory: String): SessionDto =
        ready { sessions.importCloudSession(id, directory) }

    override suspend fun statuses(): Flow<Map<String, SessionStatusDto>> =
        sessions.statuses

    override suspend fun setDirectory(id: String, directory: String) =
        sessions.setDirectory(id, directory)

    override suspend fun getDirectory(id: String, fallback: String): String =
        sessions.getDirectory(id, fallback)

    // ------ chat ------

    override suspend fun enhancePrompt(directory: String, text: String): String =
        ready { chat.enhancePrompt(directory, text) }

    override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
        app.requireReady()
        LOG.info("prompt RPC: session=$id, dir=$directory, parts=${prompt.parts.size}")
        chat.prompt(id, directory, prompt)
    }

    override suspend fun abort(id: String, directory: String) =
        ready { chat.abort(id, directory) }

    override suspend fun compact(id: String, directory: String, model: ModelSelectionDto) =
        ready { chat.compact(id, directory, model) }

    override suspend fun messages(id: String, directory: String): List<MessageWithPartsDto> =
        ready { chat.messages(id, directory) }

    override suspend fun attachmentPart(id: String, directory: String, messageId: String, partId: String, attachmentKey: String?): PartDto? =
        ready { chat.attachmentPart(id, directory, messageId, partId, attachmentKey) }

    override suspend fun events(id: String, directory: String): Flow<ChatEventDto> =
        chat.events.filter { event ->
            val sid = when (event) {
                is ChatEventDto.MessageUpdated -> event.sessionID
                is ChatEventDto.PartUpdated -> event.sessionID
                is ChatEventDto.PartDelta -> event.sessionID
                is ChatEventDto.PartRemoved -> event.sessionID
                is ChatEventDto.TurnOpen -> event.sessionID
                is ChatEventDto.TurnClose -> event.sessionID
                is ChatEventDto.SessionCreated -> event.sessionID
                is ChatEventDto.Error -> event.sessionID
                is ChatEventDto.MessageRemoved -> event.sessionID
                is ChatEventDto.PermissionAsked -> event.sessionID
                is ChatEventDto.PermissionReplied -> event.sessionID
                is ChatEventDto.QuestionAsked -> event.sessionID
                is ChatEventDto.QuestionReplied -> event.sessionID
                is ChatEventDto.QuestionRejected -> event.sessionID
                is ChatEventDto.SessionStatusChanged -> event.sessionID
                is ChatEventDto.SessionUpdated -> event.sessionID
                is ChatEventDto.SessionIdle -> event.sessionID
                is ChatEventDto.SessionCompacted -> event.sessionID
                is ChatEventDto.SessionDiffChanged -> event.sessionID
                is ChatEventDto.TodoUpdated -> event.sessionID
            }
            val passes = event is ChatEventDto.SessionCreated || sid == null || sid == id
            if (passes) LOG.debug { "${ChatLogSummary.sid(id)} pass=true ${ChatLogSummary.eventBody(event)}" }
            else LOG.debug { "${ChatLogSummary.sid(id)} pass=false srcSid=$sid ${ChatLogSummary.eventBody(event)}" }
            if (passes && event is ChatEventDto.SessionStatusChanged && event.status.type != "busy") {
                LOG.info(
                    "${ChatLogSummary.sid(id)} kind=status route=rpc-events pass=true " +
                        ChatLogSummary.status(event.status),
                )
            }
            passes
        }

    override suspend fun updateConfig(directory: String, config: ConfigUpdateDto) =
        ready { chat.updateConfig(directory, config) }

    // ------ permission / question resolution ------

    override suspend fun replyPermission(requestId: String, directory: String, reply: PermissionReplyDto) {
        app.requireReady()
        LOG.info("replyPermission: requestId=$requestId, reply=${reply.reply}")
        chat.replyPermission(requestId, directory, reply)
    }

    override suspend fun savePermissionRules(requestId: String, directory: String, rules: PermissionAlwaysRulesDto) {
        app.requireReady()
        LOG.info("savePermissionRules: requestId=$requestId")
        chat.savePermissionRules(requestId, directory, rules)
    }

    override suspend fun replyQuestion(requestId: String, directory: String, answers: QuestionReplyDto) {
        app.requireReady()
        LOG.info("replyQuestion: requestId=$requestId, answers=${answers.answers.size}")
        chat.replyQuestion(requestId, directory, answers)
    }

    override suspend fun rejectQuestion(requestId: String, directory: String) {
        app.requireReady()
        LOG.info("rejectQuestion: requestId=$requestId")
        chat.rejectQuestion(requestId, directory)
    }

    override suspend fun pendingPermissions(directory: String): List<PermissionRequestDto> =
        ready { chat.pendingPermissions(directory) }

    override suspend fun pendingQuestions(directory: String): List<QuestionRequestDto> =
        ready { chat.pendingQuestions(directory) }

    private suspend fun <T> ready(block: suspend () -> T): T {
        app.requireReady()
        return block()
    }
}
