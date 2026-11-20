@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.editor.KiloEditorGeneration
import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.session.KiloCloudSessions
import ai.kilocode.backend.session.fullFileSides
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.components.service

class KiloSessionRpcApiImpl : KiloSessionRpcApi {
    private val sessions get() = service<KiloBackendSessionManager>()
    private val chat get() = service<KiloBackendChatManager>()
    private val activity get() = service<KiloBackendAppService>().activity

    override suspend fun list(directory: String) = sessions.list(directory)
    override suspend fun recent(directory: String, limit: Int) = sessions.recent(directory, limit)
    override suspend fun create(directory: String) = sessions.create(directory)
    override suspend fun fork(id: String, directory: String, messageId: String?) = sessions.fork(id, directory, messageId)
    override suspend fun get(id: String, directory: String) = sessions.get(id, directory)
    override suspend fun delete(id: String, directory: String) = sessions.delete(id, directory)
    override suspend fun rename(id: String, directory: String, title: String) = sessions.rename(id, directory, title)
    override suspend fun share(id: String, directory: String): SessionDto = throw UnsupportedOperationException("Public session links are unavailable on this server")
    override suspend fun unshare(id: String, directory: String): SessionDto = throw UnsupportedOperationException("Public session links are unavailable on this server")
    private suspend fun cloud(directory: String) = KiloCloudSessions(service<KiloBackendCliManager>().client(), directory)
    override suspend fun cloudCapabilities(directory: String) = cloud(directory).capabilities()
    override suspend fun cloudSessions(directory: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto {
        require(gitUrl == null) { "Native cloud history cannot filter by Git remote." }
        return cloud(directory).list(cursor, limit)
    }
    override suspend fun importCloudSession(id: String, directory: String): SessionDto = cloud(directory).importSession(id)
    override suspend fun statuses() = sessions.statuses
    override suspend fun activity() = activity.activity
    override suspend fun changes() = sessions.changes
    override suspend fun setDirectory(id: String, directory: String) = sessions.setDirectory(id, directory)
    override suspend fun getDirectory(id: String, fallback: String) = sessions.getDirectory(id, fallback)

    override suspend fun enhancePrompt(directory: String, text: String, model: ModelSelectionDto?) = KiloEditorGeneration.enhance(text, model)
    override suspend fun prompt(id: String, directory: String, prompt: PromptDto) = chat.prompt(id, prompt)
    override suspend fun command(id: String, directory: String, command: String, arguments: String, prompt: PromptDto) = chat.command(id, command, arguments, prompt)
    override suspend fun abort(id: String, directory: String) = chat.abort(id)
    override suspend fun compact(id: String, directory: String, model: ModelSelectionDto) = chat.compact(id, model)
    override suspend fun revert(id: String, directory: String, messageID: String, partID: String?) {
        require(partID == null) { "This server supports message-level rollback only" }
        chat.revert(id, messageID)
    }
    override suspend fun deleteMessage(id: String, directory: String, messageID: String) = chat.deleteMessage(id, messageID)
    override suspend fun unrevert(id: String, directory: String) = chat.unrevert(id)
    override suspend fun messages(id: String, directory: String) = chat.messages(id)
    override suspend fun diff(id: String, directory: String, messageId: String?, full: Boolean): List<DiffFileDto> {
        val files = chat.diff(id, messageId, full)
        return if (full) files.map { fullFileSides(it) ?: it } else files
    }
    override suspend fun attachmentPart(id: String, directory: String, messageId: String, partId: String, attachmentKey: String?) = chat.attachmentPart(id, messageId, partId, attachmentKey)
    override suspend fun events(id: String, directory: String) = chat.observe(id)

    override suspend fun replyPermission(requestId: String, directory: String, reply: PermissionReplyDto) {
        chat.requests.replyPermission(requestId, directory, reply); activity.resolve(requestId)
    }
    override suspend fun savePermissionRules(requestId: String, directory: String, rules: PermissionAlwaysRulesDto) = chat.requests.saveRules(requestId, directory, rules)
    override suspend fun replyQuestion(requestId: String, directory: String, answers: QuestionReplyDto) {
        chat.requests.replyQuestion(requestId, directory, answers); activity.resolve(requestId)
    }
    override suspend fun rejectQuestion(requestId: String, directory: String) { chat.requests.rejectQuestion(requestId, directory); activity.resolve(requestId) }
    override suspend fun pendingPermissions(directory: String) = chat.requests.permissions(directory)
    override suspend fun pendingQuestions(directory: String) = chat.requests.questions(directory)
    override suspend fun sessionBoard(sessionID: String, directory: String, before: String?, limit: Int?) = sessions.sessionBoard(sessionID, directory, before, limit)
    override suspend fun resetSessionBoard(sessionID: String, directory: String, revision: Int) = sessions.resetSessionBoard(sessionID, directory, revision)
    override suspend fun backgroundJobs(id: String, directory: String) = sessions.backgroundJobs(id, directory)
    override suspend fun cancelBackgroundJob(id: String, directory: String) = sessions.cancelBackgroundJob(id, directory)
    override suspend fun promoteBackgroundJob(id: String, directory: String) = sessions.promoteBackgroundJob(id, directory)
}
