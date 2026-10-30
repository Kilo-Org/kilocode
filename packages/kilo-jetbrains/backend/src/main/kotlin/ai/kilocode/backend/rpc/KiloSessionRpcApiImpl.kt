@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.ForkHandoff
import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendHostedManager
import ai.kilocode.backend.app.KiloBackendActivityManager
import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.BackgroundJobDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CloudSessionListDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionBoardDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionChangeDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.service
import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.onSubscription
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

    private val activity: KiloBackendActivityManager
        get() = app.activity

    private val hosted: KiloBackendHostedManager
        get() = app.hosted

    private val app: KiloBackendAppService
        get() = appOverride ?: service()

    override suspend fun list(directory: String): SessionListDto =
        ready { workspaces.get(directory).sessions() }

    override suspend fun recent(directory: String, limit: Int): SessionListDto =
        ready { sessions.recent(directory, limit) }

    override suspend fun create(directory: String): SessionDto {
        app.requireReady()
        requireLocalDir(directory, "create")
        log.info("create session: directory=$directory")
        val session = workspaces.get(directory).createSession()
        log.info("create session: id=${session.id}, directory=$directory")
        return session
    }

    override suspend fun fork(id: String, directory: String, messageId: String?): SessionDto {
        app.requireReady()
        requireLocal(id, "fork")
        log.info("${ChatLogSummary.sid(id)} kind=fork dir=${ChatLogSummary.dir(directory)} message=${messageId != null}")
        val forked = withContext(Dispatchers.IO) { sessions.fork(id, directory, messageId) }
        withContext(Dispatchers.IO) { ForkHandoff.record(chat, forked.id, directory) }
        return forked
    }

    override suspend fun get(id: String, directory: String): SessionDto {
        app.requireReady()
        if (hosted.isHosted(id)) return hosted.get(id, organization())
        val dir = sessions.getDirectory(id, directory)
        return sessions.get(id, dir)
    }

    override suspend fun delete(id: String, directory: String) {
        app.requireReady()
        requireLocal(id, "delete")
        log.info("delete session: id=$id, directory=$directory")
        val dir = sessions.getDirectory(id, directory)
        workspaces.get(dir).deleteSession(id)
    }

    override suspend fun rename(id: String, directory: String, title: String): ai.kilocode.rpc.dto.SessionDto {
        app.requireReady()
        requireLocal(id, "rename")
        val dir = sessions.getDirectory(id, directory)
        return sessions.rename(id, dir, title)
    }

    override suspend fun share(id: String, directory: String): SessionDto {
        requireLocal(id, "share")
        return ready { sessions.share(id, sessions.getDirectory(id, directory)) }
    }

    override suspend fun unshare(id: String, directory: String): SessionDto {
        requireLocal(id, "unshare")
        return ready { sessions.unshare(id, sessions.getDirectory(id, directory)) }
    }

    override suspend fun cloudSessions(directory: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto =
        ready { sessions.cloudSessions(directory, cursor, limit, gitUrl) }

    override suspend fun importCloudSession(id: String, directory: String): SessionDto =
        ready { sessions.importCloudSession(id, directory) }

    override suspend fun statuses(): Flow<Map<String, SessionStatusDto>> =
        combine(sessions.statuses, hosted.statuses) { local, remote -> local + remote }

    override suspend fun activity(): Flow<Map<String, SessionActivityDto>> =
        activity.activity

    override suspend fun changes(): Flow<SessionChangeDto> =
        sessions.changes

    override suspend fun setDirectory(id: String, directory: String) {
        if (hosted.isHosted(id)) return
        sessions.setDirectory(id, directory)
    }

    override suspend fun getDirectory(id: String, fallback: String): String {
        hosted.directory(id)?.let { return it }
        if (HostedIDs.isWorkspace(fallback)) return fallback
        return sessions.getDirectory(id, fallback)
    }

    // ------ chat ------

    override suspend fun enhancePrompt(directory: String, text: String): String {
        requireLocalDir(directory, "enhancePrompt")
        return ready { chat.enhancePrompt(directory, text) }
    }

    override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
        app.requireReady()
        log.info("prompt RPC: session=$id, dir=$directory, parts=${prompt.parts.size}")
        if (hosted.isHosted(id)) {
            hosted.prompt(id, organization(), prompt)
            return
        }
        chat.prompt(id, directory, prompt)
    }

    override suspend fun command(id: String, directory: String, command: String, arguments: String, prompt: PromptDto) {
        app.requireReady()
        log.info("command RPC: session=$id, dir=$directory, command=$command, parts=${prompt.parts.size}")
        if (hosted.isHosted(id)) {
            hosted.command(id, organization(), command, arguments, prompt)
            return
        }
        chat.command(id, directory, command, arguments, prompt)
    }

    override suspend fun abort(id: String, directory: String) {
        app.requireReady()
        if (hosted.isHosted(id)) {
            hosted.abort(id, organization())
            return
        }
        chat.abort(id, directory)
    }

    override suspend fun compact(id: String, directory: String, model: ModelSelectionDto) {
        requireLocal(id, "compact")
        ready { chat.compact(id, directory, model) }
    }

    override suspend fun revert(id: String, directory: String, messageID: String, partID: String?) {
        requireLocal(id, "revert")
        ready { chat.revert(id, sessions.getDirectory(id, directory), messageID, partID) }
    }

    override suspend fun deleteMessage(id: String, directory: String, messageID: String): Boolean {
        requireLocal(id, "deleteMessage")
        return ready { chat.deleteMessage(id, sessions.getDirectory(id, directory), messageID) }
    }

    override suspend fun unrevert(id: String, directory: String) {
        requireLocal(id, "unrevert")
        ready { chat.unrevert(id, sessions.getDirectory(id, directory)) }
    }

    override suspend fun messages(id: String, directory: String): List<MessageWithPartsDto> {
        app.requireReady()
        if (hosted.isHosted(id)) return hosted.messages(id, organization())
        return chat.messages(id, directory)
    }

    override suspend fun diff(id: String, directory: String): List<DiffFileDto> = ready {
        if (hosted.isHosted(id)) return@ready hosted.diff(id, organization())
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
        // Hosted diffs are provider-computed patches; there is no local base to read.
        if (HostedIDs.isSession(sessionId) || HostedIDs.isWorkspace(directory)) return file
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

    override suspend fun attachmentPart(id: String, directory: String, messageId: String, partId: String, attachmentKey: String?): PartDto? {
        if (hosted.isHosted(id)) return null
        return ready { chat.attachmentPart(id, directory, messageId, partId, attachmentKey) }
    }

    override suspend fun events(id: String, directory: String): Flow<ChatEventDto> =
        channelFlow {
            log.info("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events start=true dir=${ChatLogSummary.dir(directory)}")
            val remote = source == null && hosted.isHosted(id)
            var retained = false

            try {
                // Gate: the live SharedFlow subscription must be established before the replay runs, so
                // the pending-prompt fetch cannot open a window where an event is in neither the
                // snapshot nor the live stream. For the real SharedFlow path, onSubscription fires after
                // the subscriber is registered; for the injected test source, onStart is sufficient.
                val gate = Channel<Unit>(Channel.RENDEZVOUS)
                val upstream = source
                    ?.onStart { gate.send(Unit) }
                    ?: chat.events.onSubscription { gate.send(Unit) }

                // 1. Start collecting the live stream immediately.
                val live = launch {
                    upstream
                        .filter { event ->
                            val sid = ChatLogSummary.sid(event)
                            val passes = event is ChatEventDto.SessionCreated || sid == null || sid == id
                            if (passes) logEvent(id, "pass=true", event, null)
                            else logEvent(id, "pass=false", event, sid)
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
                        .collect { send(it) }
                }

                // 2. Wait for the live subscriber to be registered, then replay any pending prompts.
                gate.receive()
                if (remote) {
                    app.requireReady()
                    // Set the flag only after retain returns: retain already decrements its own count
                    // when attachment setup fails or is cancelled, and a flag set earlier would make
                    // the finally block release a second time and drop another live subscriber.
                    hosted.retain(id, organization())
                    retained = true
                }
                replayPending(id, directory)

                // Keep the channelFlow alive until the live collector completes or is cancelled.
                live.join()
            } finally {
                if (retained) hosted.release(id)
            }
        }
            .onCompletion { cause ->
                if (cause == null || cause is CancellationException) {
                    log.info("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events stop=true cancelled=${cause is CancellationException}")
                    return@onCompletion
                }
                log.warn("${ChatLogSummary.sid(id)} kind=subscription route=rpc-events stop=true failed message=${cause.message}", cause)
            }

    // ------ permission / question resolution ------

    override suspend fun replyPermission(requestId: String, directory: String, reply: PermissionReplyDto) {
        app.requireReady()
        log.info("replyPermission: requestId=$requestId, reply=${reply.reply}")
        if (HostedIDs.isWorkspace(directory)) {
            hosted.replyPermission(requestId, directory, organization(), reply)
            activity.resolve(requestId)
            return
        }
        chat.replyPermission(requestId, directory, reply)
        if (chat.permissionPending(requestId, directory) == false) activity.resolve(requestId)
    }

    override suspend fun savePermissionRules(requestId: String, directory: String, rules: PermissionAlwaysRulesDto) {
        app.requireReady()
        if (HostedIDs.isWorkspace(directory)) return
        log.info("savePermissionRules: requestId=$requestId")
        chat.savePermissionRules(requestId, directory, rules)
    }

    override suspend fun replyQuestion(requestId: String, directory: String, answers: QuestionReplyDto) {
        app.requireReady()
        log.info("replyQuestion: requestId=$requestId, answers=${answers.answers.size}")
        if (HostedIDs.isWorkspace(directory)) {
            hosted.replyQuestion(requestId, directory, organization(), answers)
            activity.resolve(requestId)
            return
        }
        chat.replyQuestion(requestId, directory, answers)
        if (chat.questionPending(requestId, directory) == false) activity.resolve(requestId)
    }

    override suspend fun rejectQuestion(requestId: String, directory: String) {
        app.requireReady()
        log.info("rejectQuestion: requestId=$requestId")
        if (HostedIDs.isWorkspace(directory)) {
            hosted.rejectQuestion(requestId, directory, organization())
            activity.resolve(requestId)
            return
        }
        chat.rejectQuestion(requestId, directory)
        if (chat.questionPending(requestId, directory) == false) activity.resolve(requestId)
    }

    override suspend fun pendingPermissions(directory: String): List<PermissionRequestDto> =
        ready {
            if (HostedIDs.isWorkspace(directory)) hosted.pendingPermissions(directory, organization())
            else chat.pendingPermissions(directory)
        }

    override suspend fun pendingQuestions(directory: String): List<QuestionRequestDto> =
        ready {
            if (HostedIDs.isWorkspace(directory)) hosted.pendingQuestions(directory, organization())
            else chat.pendingQuestions(directory)
        }

    // ------ shared agent board ------

    override suspend fun sessionBoard(sessionID: String, directory: String, before: String?, limit: Int?): SessionBoardDto {
        requireLocal(sessionID, "sessionBoard")
        return ready { withContext(Dispatchers.IO) { sessions.sessionBoard(sessionID, directory, before, limit) } }
    }

    override suspend fun resetSessionBoard(sessionID: String, directory: String, revision: Int): SessionBoardDto? {
        requireLocal(sessionID, "resetSessionBoard")
        return ready { withContext(Dispatchers.IO) { sessions.resetSessionBoard(sessionID, directory, revision) } }
    }

    // ------ background subagents ------

    override suspend fun backgroundJobs(id: String, directory: String): Flow<List<BackgroundJobDto>> =
        if (hosted.isHosted(id)) flowOf(emptyList()) else sessions.backgroundJobs(id, directory)

    override suspend fun cancelBackgroundJob(id: String, directory: String): Boolean {
        requireLocal(id, "cancelBackgroundJob")
        return ready { withContext(Dispatchers.IO) { sessions.cancelBackgroundJob(id, directory) } }
    }

    override suspend fun promoteBackgroundJob(id: String, directory: String): Boolean {
        requireLocal(id, "promoteBackgroundJob")
        return ready { withContext(Dispatchers.IO) { sessions.promoteBackgroundJob(id, directory) } }
    }

    private fun requireLocal(id: String, op: String) {
        if (hosted.isHosted(id)) throw UnsupportedOperationException("Hosted sessions do not support $op")
    }

    private fun requireLocalDir(directory: String, op: String) {
        if (HostedIDs.isWorkspace(directory)) throw UnsupportedOperationException("Hosted workspaces do not support $op")
    }

    private fun organization(): String? =
        (app.appState.value as? KiloAppState.Ready)?.data?.profile?.currentOrgId

    private suspend fun <T> ready(block: suspend () -> T): T {
        app.requireReady()
        return block()
    }

    /**
     * Send any prompts that are already pending on the CLI for [id] so the collector starts with
     * an accurate view even when the original `question.asked` / `permission.asked` event was
     * emitted before this subscription existed. Called from [events] after the live subscription
     * is established.
     */
    private suspend fun SendChannel<ChatEventDto>.replayPending(id: String, directory: String) {
        try {
            val permissions = pendingPermissions(directory).filter { it.sessionID == id }
            val questions = pendingQuestions(directory).filter { it.sessionID == id }
            for (p in permissions) send(ChatEventDto.PermissionAsked(p.sessionID, p))
            for (q in questions) send(ChatEventDto.QuestionAsked(q.sessionID, q))
            if (permissions.isNotEmpty() || questions.isNotEmpty()) {
                log.info("${ChatLogSummary.sid(id)} route=rpc-events replay permissions=${permissions.size} questions=${questions.size}")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // App not ready yet or HTTP failure — the live flow will still deliver events once the
            // connection is up, and recoverPending in the frontend covers the startup case.
            log.debug { "${ChatLogSummary.sid(id)} route=rpc-events replay skipped: ${e.message}" }
        }
    }

    /**
     * Prompt delivery is rare and high-signal — a request that reaches a client is what a stuck
     * session hinges on — so it is logged at INFO, while the per-event noise stays on DEBUG.
     */
    private fun logEvent(id: String, tag: String, event: ChatEventDto, srcSid: String?) {
        val suffix = if (srcSid == null) "" else " srcSid=$srcSid"
        // Build the summary inside each branch: eventBody and the string concat are only paid for
        // when the level is enabled, matching the previous `log.debug { ... }` cost profile.
        if (promptEvent(event)) log.info("${ChatLogSummary.sid(id)} $tag$suffix ${ChatLogSummary.eventBody(event)}")
        else log.debug { "${ChatLogSummary.sid(id)} $tag$suffix ${ChatLogSummary.eventBody(event)}" }
    }
}

/** Returns true for the rare prompt events whose delivery is worth logging at INFO. */
private fun promptEvent(event: ChatEventDto): Boolean = when (event) {
    is ChatEventDto.PermissionAsked,
    is ChatEventDto.PermissionReplied,
    is ChatEventDto.QuestionAsked,
    is ChatEventDto.QuestionReplied,
    is ChatEventDto.QuestionRejected -> true
    else -> false
}
