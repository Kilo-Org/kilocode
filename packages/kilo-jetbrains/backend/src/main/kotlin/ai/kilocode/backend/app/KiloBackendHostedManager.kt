package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.jetbrains.api.infrastructure.ClientException
import ai.kilocode.jetbrains.api.model.SessionHostWorkspace
import ai.kilocode.jetbrains.api.model.SessionHostWorkspaceStatus
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.ConcurrentHashMap

/**
 * Local gateway for hosted Cloud workspaces and sessions.
 *
 * The IDE never talks to Cloud. This manager drives the local `kilo serve` Session Host control
 * routes, mints opaque attachments, and sends the native allowlist through those attachments. The
 * provider credential, origin, and native directory stay inside the CLI.
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService], started after the CLI is ready and
 * stopped with it. Attachments are in-memory and never survive a CLI restart.
 */
class KiloBackendHostedManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    companion object {
        private const val WORKSPACE_LIMIT = "50"
        private const val SESSION_LIMIT = "50"
        private const val MAX_BACKOFF_MS = 10_000L
        private const val INITIAL_BACKOFF_MS = 500L
        private val MODEL = Regex("[a-zA-Z0-9._/\\-:~]{1,255}")
        private val AGENT = Regex("[a-z][a-z0-9-]{0,49}")
        private val MESSAGE = Regex("msg_[0-9a-f]{12}[0-9A-Za-z]{14}")
    }

    private class Attachment(
        val id: String,
        val session: String,
        val native: String,
        val ref: HostedWorkspaceRefDto,
        val providerID: String,
        val organizationID: String?,
        @Volatile var expiresAt: Long,
    ) {
        var events: Job? = null
        var system: Job? = null
        var recovery: Job? = null
        @Volatile var invalid = false
    }

    private class Continuity {
        var retainers = 0
        var subscribers = 0
        var calls = 0
        var organizationID: String? = null
        var snapshot = false
        var generation: String? = null
        val revision = java.util.concurrent.atomic.AtomicLong()

        val retained: Boolean get() = retainers > 0
        val unused: Boolean get() = retainers == 0 && subscribers == 0 && calls == 0
    }

    private class HostedHttpException(val code: Int, message: String) : RuntimeException(message)
    private class Resnapshot : RuntimeException()

    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json".toMediaType()
    private val lock = Mutex()
    private val attachments = ConcurrentHashMap<String, Attachment>()
    private val continuity = ConcurrentHashMap<String, Continuity>()
    private var lifecycle: CoroutineScope? = null
    private val sessions = ConcurrentHashMap<String, HostedWorkspaceSessionDto>()
    private val permissionOwner = ConcurrentHashMap<String, String>()
    private val questionOwner = ConcurrentHashMap<String, String>()

    private val _statuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
    val statuses: StateFlow<Map<String, SessionStatusDto>> = _statuses.asStateFlow()

    // Replayed so a workspace editor opened just after attach still gets the latest preparation step.
    private val _system = MutableSharedFlow<HostedSystemEventDto>(replay = 8, extraBufferCapacity = 64)
    val systemEvents = _system.asSharedFlow()

    private var api: DefaultApi? = null
    private var http: OkHttpClient? = null
    private var base: String? = null
    private var chat: KiloBackendChatManager? = null
    private var statusJob: Job? = null

    @Volatile
    private var started = false

    fun start(api: DefaultApi, http: OkHttpClient, port: Int, chat: KiloBackendChatManager) {
        val endpoint = "http://127.0.0.1:$port"
        val changed = started && (this.api !== api || this.http !== http || base != endpoint || this.chat !== chat)
        val previous = this.api
        this.api = api
        this.http = http
        this.base = endpoint
        this.chat = chat
        if (started && !changed) return
        if (started) rebind(previous)
        started = true
        lifecycle = CoroutineScope(cs.coroutineContext + SupervisorJob(cs.coroutineContext[Job]))
        statusJob = lifecycle!!.launch(start = CoroutineStart.UNDISPATCHED) {
            chat.events.collect { event ->
                when (event) {
                    is ChatEventDto.SessionStatusChanged -> if (HostedIDs.isSession(event.sessionID)) {
                        _statuses.update { it + (event.sessionID to event.status) }
                    }
                    is ChatEventDto.SessionIdle -> if (HostedIDs.isSession(event.sessionID)) {
                        _statuses.update { it + (event.sessionID to SessionStatusDto("idle")) }
                    }
                    is ChatEventDto.PermissionAsked -> if (HostedIDs.isSession(event.sessionID)) {
                        permissionOwner[event.request.id] = event.sessionID
                    }
                    is ChatEventDto.QuestionAsked -> if (HostedIDs.isSession(event.sessionID)) {
                        questionOwner[event.request.id] = event.sessionID
                    }
                    is ChatEventDto.PermissionReplied -> permissionOwner.remove(event.requestID)
                    is ChatEventDto.QuestionReplied -> questionOwner.remove(event.requestID)
                    is ChatEventDto.QuestionRejected -> questionOwner.remove(event.requestID)
                    else -> Unit
                }
            }
        }
        // A restart calls stop() first, which keeps retained owners but closes transports. Reattach
        // them here even though the manager was not "started" at entry.
        if (changed || continuity.isNotEmpty()) continuity.entries.forEach { restore(it.key, it.value) }
        log.info("Hosted session manager started")
    }

    /**
     * Stops a CLI transport without forgetting live ownership. RPC collectors survive a backend
     * restart, so continuity retainers and subscribers must survive too; [start] reattaches them to
     * the replacement transport. Cached transcript/status data is dropped and rebuilt from the new
     * CLI. Use [reset] only when ownership itself is gone.
     */
    fun stop() {
        if (!started && attachments.isEmpty()) return
        started = false
        rebind(api)
        sessions.clear()
        permissionOwner.clear()
        questionOwner.clear()
        _statuses.value = emptyMap()
        api = null
        http = null
        base = null
        chat = null
        log.info("Hosted session manager stopped")
    }

    /** Full teardown for application disposal, where no RPC collector can survive the service. */
    fun close() {
        started = false
        reset(detach = true)
        api = null
        http = null
        base = null
        chat = null
    }

    /** The workspace marker used as the directory for hosted session RPC calls. */
    fun directory(id: String): String? =
        HostedIDs.parseSession(id)?.let { (provider, workspace, _) -> HostedIDs.workspace(provider, workspace) }

    // ------ discovery ------

    suspend fun providers(): List<HostedProviderDto> = withContext(Dispatchers.IO) {
        val raw = get("/kilocode/session-host/provider", "providers") ?: return@withContext emptyList()
        val items = runCatching {
            json.parseToJsonElement(raw).jsonObject["providers"]?.jsonArray ?: return@runCatching emptyList()
        }.getOrElse {
            log.warn("hosted providers parse failed message=${it.message}")
            return@withContext emptyList()
        }
        items.mapNotNull { item ->
            val obj = item.jsonObject
            val id = obj.string("id") ?: return@mapNotNull null
            val availability = obj["availability"]?.jsonObject
            val state = availability?.string("state")
            val available = state == "available"
            HostedProviderDto(
                id = id,
                default = obj["default"]?.jsonPrimitive?.contentOrNull == "true",
                available = available,
                reason = availability?.string("reason"),
                message = availability?.string("message"),
            )
        }
    }

    suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?): HostedWorkspaceListDto =
        withContext(Dispatchers.IO) {
            val page = requireApi().sessionHostListWorkspaces(
                limit = WORKSPACE_LIMIT,
                sessionLimit = SESSION_LIMIT,
                cursor = cursor,
                repositoryUrl = repositoryUrl,
                organizationID = organizationID,
            )
            val items = page.items.map { dto(it) }
            items.forEach { dto ->
                dto.sessions.forEach { sessions[it.id] = it }
            }
            val providers = providers()
            HostedWorkspaceListDto(
                items = items,
                cursor = page.cursor,
                providers = providers,
                signedOut = providers.any { !it.available && it.reason == "signed_out" },
            )
        }

    suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto =
        withContext(Dispatchers.IO) {
            val model = requireApi().sessionHostGetWorkspace(
                providerID = ref.providerID,
                workspaceID = ref.workspaceID,
                sessionLimit = SESSION_LIMIT,
                sessionCursor = sessionCursor,
                organizationID = organizationID,
            )
            val dto = dto(model)
            dto.sessions.forEach { sessions[it.id] = it }
            dto
        }

    suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto =
        withContext(Dispatchers.IO) {
            dto(requireApi().sessionHostGetWorkspaceStatus(ref.providerID, ref.workspaceID, organizationID), ref)
        }

    suspend fun systemEvents(ref: HostedWorkspaceRefDto, native: String, organizationID: String?): Flow<HostedSystemEventDto> {
        val composite = HostedIDs.session(ref.providerID, ref.workspaceID, native)
        return flow {
            val state = lock.withLock {
                continuity.computeIfAbsent(composite) { Continuity() }.also {
                    it.subscribers++
                    it.organizationID = organizationID ?: it.organizationID
                }
            }
            try {
                ensure(composite, organizationID)
                systemEvents.filter { it.sessionID == composite }.collect { emit(it) }
            } finally {
                withContext(kotlinx.coroutines.NonCancellable) {
                    lock.withLock {
                        state.subscribers--
                        if (state.subscribers == 0) {
                            attachments[composite]?.let { attachment ->
                                attachment.system?.cancel()
                                attachment.system = null
                            }
                        }
                        discard(composite, state)
                    }
                }
            }
        }
    }

    // ------ hosted session routing ------

    fun isHosted(id: String): Boolean = HostedIDs.isSession(id)

    suspend fun get(id: String, organizationID: String?): SessionDto = withContext(Dispatchers.IO) {
        val (provider, workspace, native) = parse(id)
        val marker = HostedIDs.workspace(provider, workspace)
        val cached = sessions[id] ?: runCatching {
            val dto = workspace(HostedWorkspaceRefDto(provider, workspace), null, organizationID)
            dto.sessions.firstOrNull { it.nativeSessionID == native }
        }.getOrElse {
            if (it is CancellationException) throw it
            null
        }
        HostedEventMapper.session(
            composite = id,
            directory = marker,
            title = cached?.title,
            created = cached?.created ?: 0.0,
            updated = cached?.updated ?: cached?.created ?: 0.0,
        )
    }

    suspend fun messages(id: String, organizationID: String?): List<MessageWithPartsDto> =
        attached(id, organizationID) { attachment ->
            val raw = get("/session/${attachment.native}/message?workspace=${encode(attachment.id)}", "messages")
                ?: return@attached emptyList()
            HostedEventMapper.messages(KiloCliDataParser.parseMessages(raw), id)
        }

    suspend fun prompt(id: String, organizationID: String?, prompt: PromptDto) {
        validate(prompt)
        attached(id, organizationID) { attachment ->
            val body = KiloCliDataParser.buildPromptJson(prompt)
            post(
                "/session/${attachment.native}/prompt_async?workspace=${encode(attachment.id)}",
                body,
                "prompt",
            )
        }
    }

    suspend fun command(id: String, organizationID: String?, command: String, arguments: String, prompt: PromptDto) {
        validate(prompt, command = true)
        require(command.length in 1..256) { "Hosted command must contain between 1 and 256 characters" }
        require(arguments.length <= 10_000) { "Hosted command arguments exceed 10000 characters" }
        val raw = KiloCliDataParser.buildCommandJson(command, arguments, prompt)
        val body = if (prompt.messageID == null) raw else {
            JsonObject(json.parseToJsonElement(raw).jsonObject + ("messageID" to JsonPrimitive(prompt.messageID))).toString()
        }
        attached(id, organizationID) { attachment ->
            post(
                "/session/${attachment.native}/command?workspace=${encode(attachment.id)}",
                body,
                "command",
            )
        }
    }

    private fun validate(prompt: PromptDto, command: Boolean = false) {
        require(prompt.editorContext == null) { "Hosted input does not support editor context" }
        require(prompt.variant == null) { "Hosted input does not support model variants" }
        require(prompt.noReply == null) { "Hosted input does not support noReply" }
        require((prompt.providerID == null) == (prompt.modelID == null)) { "Hosted model requires both provider and model IDs" }
        require(prompt.providerID == null || prompt.providerID == "kilo") { "Hosted input only supports the Kilo provider" }
        require(prompt.modelID?.let(MODEL::matches) != false) { "Invalid hosted model ID" }
        require(!command || prompt.modelID == null || "kilo/${prompt.modelID}".length <= 256) { "Hosted command model exceeds 256 characters" }
        require(prompt.agent?.let(AGENT::matches) != false) { "Invalid hosted agent slug" }
        require(prompt.messageID?.let(MESSAGE::matches) != false) { "Invalid hosted message ID" }
        prompt.parts.forEach { part ->
            require(part.type == "text" && part.text != null) { "Hosted input only supports text parts" }
            require(part.synthetic == null && part.source == null && part.url == null && part.mime == null && part.filename == null) {
                "Hosted text parts do not support synthetic or file metadata"
            }
        }
        if (command) return
        require(prompt.parts.isNotEmpty() && prompt.parts.sumOf { it.text.orEmpty().length.toLong() } in 1..100_000) {
            "Hosted prompt must contain between 1 and 100000 text characters"
        }
    }

    suspend fun abort(id: String, organizationID: String?) {
        attached(id, organizationID) { attachment ->
            post("/session/${attachment.native}/abort?workspace=${encode(attachment.id)}", "", "abort")
            refresh(attachment)
        }
    }

    suspend fun diff(id: String, organizationID: String?): List<DiffFileDto> =
        attached(id, organizationID) { attachment ->
            val files = requireApi().sessionDiff(
                sessionID = attachment.native,
                workspace = attachment.id,
            )
            files.mapNotNull { file ->
                val path = file.file ?: return@mapNotNull null
                DiffFileDto(path, file.additions.toInt(), file.deletions.toInt(), file.patch, file.status?.value)
            }
        }

    suspend fun pendingPermissions(directory: String, organizationID: String?): List<PermissionRequestDto> {
        val (provider, workspace) = HostedIDs.parseWorkspace(directory) ?: throw IllegalArgumentException("Not a hosted workspace")
        val ref = HostedWorkspaceRefDto(provider, workspace)
        return withContext(Dispatchers.IO) {
            val candidates = attachments.values.filter { it.ref == ref }
            check(candidates.isNotEmpty()) { "No hosted session attachment for pendingPermissions" }
            candidates.flatMap { candidate ->
                attached(candidate.session, organizationID) { attachment ->
                    val raw = get("/permission?workspace=${encode(attachment.id)}", "pendingPermissions", strict = true)
                        ?: throw IllegalStateException("Missing pendingPermissions response")
                    val requests = pending(raw, "pendingPermissions", KiloCliDataParser::parsePermissionRequests)
                        .map { it.copy(sessionID = attachment.session) }
                    permissionOwner.entries.removeIf { it.value == attachment.session }
                    requests.forEach { request ->
                        permissionOwner[request.id] = attachment.session
                    }
                    requests
                }
            }
        }
    }

    suspend fun pendingQuestions(directory: String, organizationID: String?): List<QuestionRequestDto> {
        val (provider, workspace) = HostedIDs.parseWorkspace(directory) ?: throw IllegalArgumentException("Not a hosted workspace")
        val ref = HostedWorkspaceRefDto(provider, workspace)
        return withContext(Dispatchers.IO) {
            val candidates = attachments.values.filter { it.ref == ref }
            check(candidates.isNotEmpty()) { "No hosted session attachment for pendingQuestions" }
            candidates.flatMap { candidate ->
                attached(candidate.session, organizationID) { attachment ->
                    val raw = get("/question?workspace=${encode(attachment.id)}", "pendingQuestions", strict = true)
                        ?: throw IllegalStateException("Missing pendingQuestions response")
                    val requests = pending(raw, "pendingQuestions", KiloCliDataParser::parseQuestionRequests)
                        .map { it.copy(sessionID = attachment.session) }
                    questionOwner.entries.removeIf { it.value == attachment.session }
                    requests.forEach { request ->
                        questionOwner[request.id] = attachment.session
                    }
                    requests
                }
            }
        }
    }

    private fun <T> pending(raw: String, op: String, parser: (String) -> List<T>): List<T> {
        val array = json.parseToJsonElement(raw) as? JsonArray
            ?: throw IllegalArgumentException("Invalid $op response: expected an array")
        return array.map { entry ->
            val parsed = parser(JsonArray(listOf(entry)).toString())
            require(parsed.size == 1) { "Invalid $op response entry" }
            parsed.single()
        }
    }

    suspend fun replyPermission(
        requestId: String,
        directory: String,
        organizationID: String?,
        reply: PermissionReplyDto,
    ) {
        val session = permissionOwner[requestId] ?: findOwner(requestId, directory, question = false)
        val body = KiloCliDataParser.buildPermissionReplyJson(reply)
        if (session != null) {
            attached(session, organizationID) { attachment ->
                post("/permission/$requestId/reply?workspace=${encode(attachment.id)}", body, "replyPermission")
            }
            return
        }
        postToWorkspace(directory, "/permission/$requestId/reply", body, "replyPermission", organizationID)
    }

    suspend fun replyQuestion(
        requestId: String,
        directory: String,
        organizationID: String?,
        answers: QuestionReplyDto,
    ) {
        val session = questionOwner[requestId] ?: findOwner(requestId, directory, question = true)
        val body = KiloCliDataParser.buildQuestionReplyJson(answers)
        if (session != null) {
            attached(session, organizationID) { attachment ->
                post("/question/$requestId/reply?workspace=${encode(attachment.id)}", body, "replyQuestion")
            }
            return
        }
        postToWorkspace(directory, "/question/$requestId/reply", body, "replyQuestion", organizationID)
    }

    suspend fun rejectQuestion(requestId: String, directory: String, organizationID: String?) {
        val session = questionOwner[requestId] ?: findOwner(requestId, directory, question = true)
        if (session != null) {
            attached(session, organizationID) { attachment ->
                post("/question/$requestId/reject?workspace=${encode(attachment.id)}", "{}", "rejectQuestion")
            }
            return
        }
        postToWorkspace(directory, "/question/$requestId/reject", "{}", "rejectQuestion", organizationID)
    }

    // ------ attachments and streams ------

    suspend fun retain(id: String, organizationID: String?) {
        parse(id)
        val state = lock.withLock {
            continuity.computeIfAbsent(id) { Continuity() }.also {
                it.retainers++
                it.organizationID = organizationID ?: it.organizationID
            }
        }
        try {
            ensure(id, organizationID)
        } catch (err: CancellationException) {
            withContext(kotlinx.coroutines.NonCancellable) {
                lock.withLock {
                    state.retainers--
                    discard(id, state)
                }
            }
            throw err
        } catch (err: Exception) {
            // A cold/transient attach failure must not tear down the caller's live subscription:
            // SessionController logs a failed events flow and never resubscribes. Keep the retained
            // owner and let restore() retry, then start the native loop once the attachment exists.
            log.warn("hosted retention deferred session=${ChatLogSummary.sid(id)} message=${err.message}", err)
            restore(id, state)
        }
    }

    /** Releases one native transcript stream owner while leaving passive system observation intact. */
    suspend fun release(id: String) = withContext(kotlinx.coroutines.NonCancellable) {
        lock.withLock {
            val state = continuity[id] ?: return@withLock
            if (state.retainers == 0) return@withLock
            state.retainers--
            if (state.retainers > 0) return@withLock
            attachments[id]?.let { attachment ->
                attachment.events?.cancel()
                attachment.events = null
            }
            permissionOwner.entries.removeIf { it.value == id }
            questionOwner.entries.removeIf { it.value == id }
            _statuses.update { it - id }
            discard(id, state)
        }
    }

    private suspend fun ensure(id: String, organizationID: String?, expected: Attachment? = null): Attachment =
        (lifecycle ?: throw IllegalStateException("Hosted session manager not started")).async {
        val (provider, workspace, native) = parse(id)
        lock.withLock {
            check(started) { "Hosted session manager not started" }
            if (expected != null && attachments[id] !== expected) {
                return@withLock attachments[id] ?: throw CancellationException("Hosted attachment released")
            }
            val state = continuity.computeIfAbsent(id) { Continuity() }
            val existing = attachments[id]
            // expiresAt describes the provider descriptor, not the opaque CLI attachment lease.
            if (existing != null && !existing.invalid) {
                if (state.retained && existing.events == null) startNative(existing)
                if (state.subscribers > 0 && existing.system == null) startSystem(existing)
                return@withLock existing
            }
            val attached = withContext(Dispatchers.IO) {
                requireApi().sessionHostAttach(provider, native, organizationID)
            }
            val expires = if (attached.expiresAt < 1_000_000_000_000.0) {
                (attached.expiresAt * 1000).toLong()
            } else {
                attached.expiresAt.toLong()
            }
            val attachment = Attachment(
                id = attached.attachmentID,
                session = id,
                native = native,
                ref = HostedWorkspaceRefDto(provider, workspace),
                providerID = provider,
                organizationID = organizationID,
                expiresAt = expires,
            )
            attachments[id] = attachment
            startStreams(attachment)
            if (existing != null) close(existing, recovery = expected == null)
            if (state.unused) {
                attachments.remove(id, attachment)
                continuity.remove(id, state)
                close(attachment)
                throw CancellationException("Hosted attachment released")
            }
            log.info("hosted attach session=${ChatLogSummary.sid(id)} attachment=${attachment.id} expiresAt=$expires")
            attachment
        }
    }.await()

    private suspend fun <T> attached(id: String, organizationID: String?, block: suspend (Attachment) -> T): T {
        val (provider, workspace, _) = parse(id)
        val state = lock.withLock {
            continuity.computeIfAbsent(id) { Continuity() }.also {
                it.calls++
                it.organizationID = organizationID ?: it.organizationID
            }
        }
        try {
            var failure: Throwable? = null
            repeat(2) { attempt ->
                val attachment = ensure(id, organizationID)
                try {
                    return block(attachment)
                } catch (e: HostedHttpException) {
                    failure = e
                    if (attempt == 0 && (e.code == 404 || e.code == 410)) {
                        log.info("hosted attachment expired session=${ChatLogSummary.sid(id)} code=${e.code} reattach=true")
                        attachment.invalid = true
                        return@repeat
                    }
                    throw e
                } catch (e: ClientException) {
                    failure = e
                    if (attempt == 0 && e.statusCode in setOf(404, 410)) {
                        attachment.invalid = true
                        return@repeat
                    }
                    throw e
                }
            }
            throw failure ?: IllegalStateException("Hosted session call failed for $provider/$workspace")
        } finally {
            withContext(kotlinx.coroutines.NonCancellable) {
                lock.withLock {
                    state.calls--
                    discard(id, state)
                }
            }
        }
    }

    private fun startStreams(attachment: Attachment) {
        if (continuity[attachment.session]?.retained == true) startNative(attachment)
        if ((continuity[attachment.session]?.subscribers ?: 0) > 0) startSystem(attachment)
    }

    private fun startNative(attachment: Attachment) {
        if (attachment.events?.isActive == true) return
        attachment.events = lifecycle?.launch(Dispatchers.IO) { eventLoop(attachment) }
    }

    private fun startSystem(attachment: Attachment) {
        if (attachment.system?.isActive == true) return
        attachment.system = lifecycle?.launch(Dispatchers.IO) { systemLoop(attachment) }
    }

    private fun recover(attachment: Attachment) {
        synchronized(attachment) {
            if (attachment.recovery?.isActive == true) return
            attachment.invalid = true
            attachment.recovery = lifecycle?.launch(Dispatchers.IO) {
                var backoff = INITIAL_BACKOFF_MS
                while (started && attachments[attachment.session] === attachment) {
                    try {
                        ensure(attachment.session, attachment.organizationID, expected = attachment)
                        return@launch
                    } catch (err: CancellationException) {
                        throw err
                    } catch (err: Exception) {
                        log.warn("hosted reattach failed session=${ChatLogSummary.sid(attachment.session)} message=${err.message}")
                    }
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
                }
            }
        }
    }

    private fun restore(id: String, state: Continuity) {
        lifecycle?.launch(Dispatchers.IO) {
            var backoff = INITIAL_BACKOFF_MS
            while (started && continuity[id] === state && !state.unused && attachments[id] == null) {
                try {
                    ensure(id, state.organizationID)
                    return@launch
                } catch (err: CancellationException) {
                    throw err
                } catch (err: Exception) {
                    log.warn("hosted reconnect failed session=${ChatLogSummary.sid(id)} message=${err.message}")
                }
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            }
        }
    }

    private suspend fun eventLoop(attachment: Attachment) {
        var backoff = INITIAL_BACKOFF_MS
        val state = continuity[attachment.session] ?: return
        while (started && attachments[attachment.session] === attachment) {
            val normalizer = KiloCliDataParser.ChatEventNormalizer()
            val opened = stream(
                "/event?workspace=${encode(attachment.id)}",
                onOpen = {
                    state.snapshot = true
                    chat?.publishAwait(ChatEventDto.Resnapshot(attachment.session, phase = "start"))
                    backoff = INITIAL_BACKOFF_MS
                },
            ) { type, data ->
                if (attachments[attachment.session] !== attachment) return@stream
                val obj = json.parseToJsonElement(data) as? JsonObject
                val payload = obj?.get("payload") as? JsonObject ?: obj
                val kind = payload?.string("type") ?: type ?: KiloCliDataParser.extractEventType(data)
                if (kind == "kilo.native.resnapshot") {
                    state.snapshot = true
                    throw Resnapshot()
                }
                if (kind == "kilo.native.fence") {
                    val props = payload?.get("properties") as? JsonObject
                    if (state.snapshot && (props?.get("snapshotComplete") as? JsonPrimitive)?.contentOrNull == "true") {
                        state.generation = (props["generation"] as? JsonPrimitive)?.contentOrNull
                        refresh(attachment)
                        if (attachments[attachment.session] !== attachment) return@stream
                        state.snapshot = false
                        chat?.publishAwait(ChatEventDto.Resnapshot(attachment.session))
                    }
                    return@stream
                }
                val parsed = runCatching { normalizer.parse(kind, data) }.getOrElse {
                    log.warn("hosted event parse failed kind=$kind message=${it.message}")
                    null
                }
                if (parsed == null) {
                    if (kind != "server.heartbeat" && kind != "unknown") {
                        log.warn("hosted event dropped kind=$kind session=${ChatLogSummary.sid(attachment.session)}")
                    }
                    return@stream
                }
                parsed.forEach { event ->
                    val mapped = HostedEventMapper.event(event, attachment.session, attachment.ref.key)
                    if (mapped is ChatEventDto.SessionStatusChanged || mapped is ChatEventDto.SessionIdle) state.revision.incrementAndGet()
                    chat?.publishAwait(mapped)
                }
            }
            if (!started || attachments[attachment.session] !== attachment) return
            if (opened in setOf(404, 410)) {
                recover(attachment)
                return
            }
            if (opened !in 200..299) backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            delay(backoff)
        }
    }

    private suspend fun systemLoop(attachment: Attachment) {
        var backoff = INITIAL_BACKOFF_MS
        while (started && attachments[attachment.session] === attachment) {
            val opened = stream("/cloud-agent/event?workspace=${encode(attachment.id)}") { type, data ->
                runCatching { HostedSystemEventParser.parse(attachment.session, attachment.native, type, data) }
                    .onFailure { log.warn("hosted system event parse failed message=${it.message}") }
                    .getOrNull()?.let { _system.tryEmit(it) }
            }
            if (!started || attachments[attachment.session] !== attachment) return
            if (opened in setOf(404, 410)) {
                recover(attachment)
                return
            }
            backoff = if (opened in 200..299) INITIAL_BACKOFF_MS else (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            delay(backoff)
        }
    }

    /**
     * Consume callbacks in wire order, including the status read at the snapshot fence. A bounded
     * overflow closes the stream so the next full snapshot recovers rather than losing live events.
     */
    private suspend fun stream(
        path: String,
        onOpen: suspend () -> Unit = {},
        onEvent: suspend (String?, String) -> Unit,
    ): Int {
        val client = http ?: return 0
        val url = base ?: return 0
        val source = java.util.concurrent.atomic.AtomicReference<EventSource?>(null)
        data class Frame(val type: String?, val data: String?)
        val frames = Channel<Frame>(256)
        val code = java.util.concurrent.atomic.AtomicInteger()
        val factory = EventSources.createFactory(
            client.newBuilder()
                .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build(),
        )
        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: okhttp3.Response) {
                source.set(eventSource)
                code.set(response.code)
                frames.trySend(Frame(null, null))
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (frames.trySend(Frame(type, data)).isFailure) {
                    frames.close()
                    eventSource.cancel()
                }
            }

            override fun onClosed(eventSource: EventSource) {
                frames.close()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                if (t != null) log.debug { "hosted stream closed path=$path message=${t.message}" }
                response?.let { code.set(it.code) }
                frames.close()
            }
        }
        val eventSource = factory.newEventSource(Request.Builder().url("$url$path").build(), listener)
        return try {
            for (frame in frames) {
                try {
                    if (frame.data == null) onOpen() else onEvent(frame.type, frame.data)
                } catch (err: CancellationException) {
                    throw err
                } catch (_: Resnapshot) {
                    return code.get()
                } catch (err: Exception) {
                    log.warn("hosted stream event failed path=$path message=${err.message}")
                }
            }
            code.get()
        } finally {
            (source.get() ?: eventSource).cancel()
        }
    }

    private fun close(
        attachment: Attachment,
        detach: Boolean = true,
        recovery: Boolean = true,
        client: DefaultApi? = api,
    ) {
        attachment.events?.cancel()
        attachment.system?.cancel()
        if (recovery) attachment.recovery?.cancel()
        attachment.events = null
        attachment.system = null
        attachment.recovery = null
        if (detach && client != null) {
            cs.launch(Dispatchers.IO) {
                runCatching { client.sessionHostDetach(attachment.id) }
                    .onFailure { log.debug { "hosted detach failed attachment=${attachment.id} message=${it.message}" } }
            }
        }
    }

    private fun discard(id: String, state: Continuity) {
        if (!state.unused) return
        attachments.remove(id)?.let { close(it) }
        continuity.remove(id, state)
        _statuses.update { it - id }
    }

    private fun reset(detach: Boolean, client: DefaultApi? = api) {
        statusJob?.cancel()
        statusJob = null
        attachments.values.forEach { close(it, detach, client = client) }
        attachments.clear()
        continuity.clear()
        lifecycle?.cancel()
        lifecycle = null
        sessions.clear()
        permissionOwner.clear()
        questionOwner.clear()
        _statuses.value = emptyMap()
    }

    private fun rebind(client: DefaultApi?) {
        statusJob?.cancel()
        statusJob = null
        lifecycle?.cancel()
        lifecycle = null
        attachments.values.forEach { close(it, client = client) }
        attachments.clear()
    }

    // ------ helpers ------

    private suspend fun refresh(attachment: Attachment) {
        val state = continuity[attachment.session] ?: return
        val revision = state.revision.get()
        try {
            val raw = withContext(Dispatchers.IO) {
                get("/session/status?workspace=${encode(attachment.id)}", "statuses")
            } ?: return
            val status = (json.parseToJsonElement(raw) as? JsonObject)?.get(attachment.native) as? JsonObject ?: return
            if (attachments[attachment.session] !== attachment || state.revision.get() != revision) return
            val parsed = KiloCliDataParser.parseStatus(status)
            _statuses.update { it + (attachment.session to parsed) }
            chat?.publishAwait(ChatEventDto.SessionStatusChanged(attachment.session, parsed))
        } catch (err: CancellationException) {
            throw err
        } catch (err: HostedHttpException) {
            recover(attachment)
        } catch (err: Exception) {
            log.warn("hosted status refresh failed session=${ChatLogSummary.sid(attachment.session)} message=${err.message}")
        }
    }

    private fun parse(id: String): Triple<String, String, String> =
        HostedIDs.parseSession(id) ?: throw IllegalArgumentException("Not a hosted session id")

    private fun findOwner(requestId: String, directory: String, question: Boolean): String? {
        val owner = if (question) questionOwner else permissionOwner
        owner[requestId]?.let { return it }
        if (!HostedIDs.isWorkspace(directory)) return null
        return attachments.values.firstOrNull { it.ref.key == directory }?.session
    }

    private suspend fun postToWorkspace(
        directory: String,
        path: String,
        body: String,
        op: String,
        organizationID: String?,
    ) {
        val ref = HostedWorkspaceRefDto.parse(directory) ?: throw IllegalArgumentException("Not a hosted workspace")
        val candidate = attachments.values.firstOrNull { it.ref == ref }?.session
        if (candidate != null) {
            attached(candidate, organizationID) { attachment ->
                post("$path?workspace=${encode(attachment.id)}", body, op)
            }
            return
        }
        throw IllegalStateException("No hosted session attachment for $op")
    }

    private fun get(path: String, op: String, strict: Boolean = false): String? {
        val client = http ?: if (strict) throw IllegalStateException("Hosted session manager not started") else return null
        val url = base ?: if (strict) throw IllegalStateException("Hosted session manager not started") else return null
        val request = Request.Builder().url("$url$path").get().build()
        return client.newCall(request).execute().use { response ->
            val raw = response.body?.string()
            if (!response.isSuccessful) {
                if (strict || response.code in setOf(404, 410)) throw HostedHttpException(response.code, "$op failed: HTTP ${response.code}")
                log.warn("hosted $op failed: HTTP ${response.code}")
                return null
            }
            raw ?: if (strict) throw IllegalStateException("Missing $op response") else null
        }
    }

    private fun post(path: String, body: String, op: String) {
        val client = http ?: throw IllegalStateException("Hosted session manager not started")
        val url = base ?: throw IllegalStateException("Hosted session manager not started")
        val request = Request.Builder()
            .url("$url$path")
            .post(body.toRequestBody(media))
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val raw = response.body?.string()
                if (response.code in setOf(404, 410)) {
                    throw HostedHttpException(response.code, "$op failed: HTTP ${response.code}")
                }
                log.warn("hosted $op failed: HTTP ${response.code}")
                throw RuntimeException("$op failed: HTTP ${response.code}${raw?.let { ": ${it.take(200)}" }.orEmpty()}")
            }
        }
    }

    private fun requireApi(): DefaultApi =
        api ?: throw IllegalStateException("Hosted session manager not started")

    private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")

    private fun dto(model: SessionHostWorkspace): HostedWorkspaceDto {
        val ref = HostedWorkspaceRefDto(model.id.providerID, model.id.workspaceID)
        return HostedWorkspaceDto(
            ref = ref,
            name = model.name,
            repositoryUrl = model.repository.url,
            branch = model.repository.branch,
            profileID = model.profileID,
            deletionState = model.deletionState.value,
            created = model.created,
            updated = model.updated,
            lastActivity = model.lastActivity,
            sessions = model.sessions.map { session ->
                HostedWorkspaceSessionDto(
                    id = HostedIDs.session(ref.providerID, ref.workspaceID, session.id.sessionID),
                    nativeSessionID = session.id.sessionID,
                    title = session.title,
                    createdOnPlatform = session.createdOnPlatform,
                    created = session.created,
                    updated = session.updated,
                )
            },
            sessionCursor = model.cursor,
        )
    }

    private fun dto(model: SessionHostWorkspaceStatus, ref: HostedWorkspaceRefDto): HostedWorkspaceStatusDto =
        HostedWorkspaceStatusDto(
            ref = ref,
            deletionState = model.deletionState.value,
            computeStatus = model.compute.status.value,
            computeDetail = model.compute.detailCode.value,
            observedAt = model.observedAt ?: 0.0,
            estimatedSleepAt = model.compute.estimatedSleepAt,
            activeSessionCount = model.activity.activeSessionCount.toInt(),
            hasActiveTurn = model.activity.hasActiveTurn,
            wakeAvailable = model.wakeOnInput.available,
            wakeBlockedReason = model.wakeOnInput.blockedReason?.value,
            rateMicrodollarsPerHour = model.billing.rate?.estimatedHourlyMicrodollars,
            billingBlocked = model.billing.blocked,
        )

    private fun JsonObject.string(name: String): String? =
        this[name]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
}
