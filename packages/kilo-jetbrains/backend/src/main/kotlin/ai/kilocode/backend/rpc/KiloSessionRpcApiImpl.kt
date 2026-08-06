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
import ai.kilocode.rpc.dto.DiffFileDto
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import ai.kilocode.backend.diff.DiffFullReconstruct
import java.nio.file.Files
import java.nio.file.Path

/**
 * Backend implementation of [KiloSessionRpcApi].
 *
 * Session CRUD routes through the [KiloBackendWorkspaceManager] to
 * get the correct workspace for a directory. Status tracking and
 * worktree directory management go directly to the
 * [KiloBackendSessionManager]. Chat operations delegate to
 * [KiloBackendChatManager].
 */
class KiloSessionRpcApiImpl internal constructor(
    private val appOverride: KiloBackendAppService? = null,
    private val log: KiloLog = LOG,
    private val source: Flow<ChatEventDto>? = null,
) : KiloSessionRpcApi {
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
        get() = appOverride ?: service()

    override suspend fun list(directory: String): SessionListDto =
        ready { workspaces.get(directory).sessions() }

    override suspend fun recent(directory: String, limit: Int): SessionListDto =
        ready { sessions.recent(directory, limit) }

    override suspend fun create(directory: String): SessionDto {
        app.requireReady()
        log.info("create session: directory=$directory")
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
        log.info("prompt RPC: session=$id, dir=$directory, parts=${prompt.parts.size}")
        chat.prompt(id, directory, prompt)
    }

    override suspend fun command(id: String, directory: String, command: String, arguments: String, prompt: PromptDto) {
        app.requireReady()
        log.info("command RPC: session=$id, dir=$directory, command=$command, parts=${prompt.parts.size}")
        chat.command(id, directory, command, arguments, prompt)
    }

    override suspend fun abort(id: String, directory: String) =
        ready { chat.abort(id, directory) }

    override suspend fun compact(id: String, directory: String, model: ModelSelectionDto) =
        ready { chat.compact(id, directory, model) }

    override suspend fun revert(id: String, directory: String, messageID: String, partID: String?) =
        ready { chat.revert(id, sessions.getDirectory(id, directory), messageID, partID) }

    override suspend fun deleteMessage(id: String, directory: String, messageID: String): Boolean =
        ready { chat.deleteMessage(id, sessions.getDirectory(id, directory), messageID) }

    override suspend fun unrevert(id: String, directory: String) =
        ready { chat.unrevert(id, sessions.getDirectory(id, directory)) }

    override suspend fun messages(id: String, directory: String): List<MessageWithPartsDto> =
        ready { chat.messages(id, directory) }

    override suspend fun diff(id: String, directory: String): List<DiffFileDto> = ready {
        // GET /session/:id/diff returns the cumulative, deduplicated, unquoted snapshot diff. Prefer it
        // over concatenating per-message summaries (which duplicate files per turn and skip unquoting).
        val api = app.api ?: throw IllegalStateException("Kilo API is unavailable")
        withContext(Dispatchers.IO) { api.sessionDiff(sessionID = id, directory = directory) }
            .mapNotNull { file ->
                val path = file.file ?: return@mapNotNull null
                DiffFileDto(path, file.additions.toInt(), file.deletions.toInt(), file.patch, file.status?.value)
            }
    }

    override suspend fun diffSides(sessionId: String?, directory: String, file: DiffFileDto, messageId: String?): DiffFileDto? {
        val patch = file.patch
        if (patch.isNullOrBlank()) return null
        log.info("diffSides start file=${file.file} session=${!sessionId.isNullOrBlank()} message=${!messageId.isNullOrBlank()} patch=${patch.length}")
        // 1) Authoritative: a CLI with full/file support returns whole before/after from the snapshot,
        //    correct even for historical turns. Older CLIs ignore the params, so we detect the missing
        //    content and fall through to local reconstruction.
        if (!sessionId.isNullOrBlank()) authoritative(sessionId, directory, file, messageId)?.let {
            log.info("diffSides authoritative file=${file.file} before=${it.before?.length ?: 0} after=${it.after?.length ?: 0}")
            return it
        }
        // 2) Fallback: read the working-tree file and reverse-apply the hunk patch to recover the whole
        //    "before". No CLI round-trip, so this works against any pinned CLI.
        return withContext(Dispatchers.IO) {
            val path = resolve(directory, file.file)
            val after = path?.let { runCatching { Files.readString(it) }.getOrNull() }
            val before = after?.let { DiffFullReconstruct.before(it, patch) }
            log.info("diffSides fallback file=${file.file} path=${path ?: "<missing>"} after=${after?.length ?: 0} before=${before?.length ?: 0}")
            if (after != null && before != null) file.copy(before = before, after = after) else null
        }
    }

    private fun resolve(directory: String, file: String): Path? {
        val direct = Path.of(directory).resolve(file).normalize()
        if (Files.isRegularFile(direct)) return direct
        // dev-only: a stored diff may reference another worktree (relative, or absolute into a sibling
        // worktree that isn't checked out here). Re-root onto the running worktree by trying progressively
        // shorter path suffixes until one exists, so full-file diffs work across dev worktrees.
        val root = System.getProperty("kilo.dev.worktree.root")?.takeIf { it.isNotBlank() }?.let(Path::of) ?: return null
        val segs = Path.of(file).toList()
        for (i in segs.indices) {
            val candidate = segs.drop(i).fold(root) { acc, seg -> acc.resolve(seg) }.normalize()
            if (Files.isRegularFile(candidate)) return candidate
        }
        return null
    }

    // Ask the CLI for full before/after via GET /session/:id/diff?full=true&file=...; returns null when
    // the pinned CLI lacks full/file support (it omits before/after) so the caller falls back locally.
    private suspend fun authoritative(sessionId: String, directory: String, file: DiffFileDto, messageId: String?): DiffFileDto? {
        val api = app.api ?: return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val url = (api.baseUrl.trimEnd('/') + "/").toHttpUrlOrNull()
                    ?.newBuilder()
                    ?.addPathSegment("session")
                    ?.addPathSegment(sessionId)
                    ?.addPathSegment("diff")
                    ?.addQueryParameter("directory", directory)
                    ?.addQueryParameter("full", "true")
                    ?.addQueryParameter("file", file.file)
                    ?.apply { if (!messageId.isNullOrBlank()) addQueryParameter("messageID", messageId) }
                    ?.build()
                    ?: return@runCatching null
                api.client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
                    if (!response.isSuccessful) {
                        log.info("diffSides authoritative file=${file.file} http=${response.code} messageID=${messageId ?: "none"}")
                        return@runCatching null
                    }
                    val arr = Json.parseToJsonElement(response.body?.string().orEmpty()).jsonArray
                    val item = arr.firstOrNull { it.jsonObject["file"]?.jsonPrimitive?.contentOrNull == file.file }?.jsonObject
                    val before = item?.get("before")?.jsonPrimitive?.contentOrNull
                    val after = item?.get("after")?.jsonPrimitive?.contentOrNull
                    log.info("diffSides authoritative file=${file.file} items=${arr.size} matched=${item != null} before=${before?.length ?: 0} after=${after?.length ?: 0}")
                    if (before != null && after != null) file.copy(before = before, after = after) else null
                }
            }.onFailure { log.info("diffSides authoritative file=${file.file} error=${it.message}") }.getOrNull()
        }
    }

    override suspend fun attachmentPart(id: String, directory: String, messageId: String, partId: String, attachmentKey: String?): PartDto? =
        ready { chat.attachmentPart(id, directory, messageId, partId, attachmentKey) }

    override suspend fun events(id: String, directory: String): Flow<ChatEventDto> =
        (source ?: chat.events)
            .onStart { log.info("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events start=true dir=${ChatLogSummary.dir(directory)}") }
            .filter { event ->
                val sid = ChatLogSummary.sid(event)
                val passes = event is ChatEventDto.SessionCreated || sid == null || sid == id
                if (passes) log.debug { "${ChatLogSummary.sid(id)} pass=true ${ChatLogSummary.eventBody(event)}" }
                else log.debug { "${ChatLogSummary.sid(id)} pass=false srcSid=$sid ${ChatLogSummary.eventBody(event)}" }
                if (passes) {
                    ChatLogSummary.error(event)?.let { log.warn("${ChatLogSummary.sid(id)} route=rpc-events pass=true $it") }
                }
                if (passes && event is ChatEventDto.SessionStatusChanged && event.status.type != "busy") {
                    log.info(
                        "${ChatLogSummary.sid(id)} kind=status route=rpc-events pass=true " +
                            ChatLogSummary.status(event.status),
                    )
                }
                passes
            }
            .onCompletion { cause ->
                if (cause == null || cause is CancellationException) {
                    log.info("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events stop=true cancelled=${cause is CancellationException}")
                    return@onCompletion
                }
                log.warn("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events stop=true failed message=${cause.message}", cause)
            }

    override suspend fun updateConfig(directory: String, config: ConfigUpdateDto) =
        ready { chat.updateConfig(directory, config) }

    // ------ permission / question resolution ------

    override suspend fun replyPermission(requestId: String, directory: String, reply: PermissionReplyDto) {
        app.requireReady()
        log.info("replyPermission: requestId=$requestId, reply=${reply.reply}")
        chat.replyPermission(requestId, directory, reply)
    }

    override suspend fun savePermissionRules(requestId: String, directory: String, rules: PermissionAlwaysRulesDto) {
        app.requireReady()
        log.info("savePermissionRules: requestId=$requestId")
        chat.savePermissionRules(requestId, directory, rules)
    }

    override suspend fun replyQuestion(requestId: String, directory: String, answers: QuestionReplyDto) {
        app.requireReady()
        log.info("replyQuestion: requestId=$requestId, answers=${answers.answers.size}")
        chat.replyQuestion(requestId, directory, answers)
    }

    override suspend fun rejectQuestion(requestId: String, directory: String) {
        app.requireReady()
        log.info("rejectQuestion: requestId=$requestId")
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
