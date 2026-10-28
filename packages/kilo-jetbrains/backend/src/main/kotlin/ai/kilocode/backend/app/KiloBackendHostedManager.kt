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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
        private const val RENEW_WINDOW_MS = 5_000L
        private const val MAX_BACKOFF_MS = 10_000L
        private const val INITIAL_BACKOFF_MS = 500L
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
    }

    private class HostedHttpException(val code: Int, message: String) : RuntimeException(message)

    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json".toMediaType()
    private val lock = Mutex()
    private val attachments = ConcurrentHashMap<String, Attachment>()
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
        if (started) return
        this.api = api
        this.http = http
        this.base = "http://127.0.0.1:$port"
        this.chat = chat
        started = true
        statusJob = cs.launch {
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
        log.info("Hosted session manager started")
    }

    fun stop() {
        if (!started && attachments.isEmpty()) return
        started = false
        statusJob?.cancel()
        statusJob = null
        attachments.values.forEach { close(it) }
        attachments.clear()
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
        ensure(composite, organizationID)
        return systemEvents.filter { it.sessionID == composite }
    }

    // ------ hosted session routing ------

    fun isHosted(id: String): Boolean = HostedIDs.isSession(id)

    suspend fun get(id: String, organizationID: String?): SessionDto = withContext(Dispatchers.IO) {
        val (provider, workspace, native) = parse(id)
        val marker = HostedIDs.workspace(provider, workspace)
        val cached = sessions[id] ?: runCatching {
            val dto = workspace(HostedWorkspaceRefDto(provider, workspace), null, organizationID)
            dto.sessions.firstOrNull { it.nativeSessionID == native }
        }.getOrNull()
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
        attached(id, organizationID) { attachment ->
            val body = KiloCliDataParser.buildCommandJson(command, arguments, prompt)
            post(
                "/session/${attachment.native}/command?workspace=${encode(attachment.id)}",
                body,
                "command",
            )
        }
    }

    suspend fun abort(id: String, organizationID: String?) {
        attached(id, organizationID) { attachment ->
            post("/session/${attachment.native}/abort?workspace=${encode(attachment.id)}", "", "abort")
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
        val (provider, workspace) = HostedIDs.parseWorkspace(directory) ?: return emptyList()
        val ref = HostedWorkspaceRefDto(provider, workspace)
        return withContext(Dispatchers.IO) {
            attachments.values
                .filter { it.ref == ref }
                .flatMap { attachment ->
                    val raw = get("/permission?workspace=${encode(attachment.id)}", "pendingPermissions")
                        ?: return@flatMap emptyList()
                    KiloCliDataParser.parsePermissionRequests(raw).map { request ->
                        permissionOwner[request.id] = attachment.session
                        request.copy(sessionID = attachment.session)
                    }
                }
        }
    }

    suspend fun pendingQuestions(directory: String, organizationID: String?): List<QuestionRequestDto> {
        val (provider, workspace) = HostedIDs.parseWorkspace(directory) ?: return emptyList()
        val ref = HostedWorkspaceRefDto(provider, workspace)
        return withContext(Dispatchers.IO) {
            attachments.values
                .filter { it.ref == ref }
                .flatMap { attachment ->
                    val raw = get("/question?workspace=${encode(attachment.id)}", "pendingQuestions")
                        ?: return@flatMap emptyList()
                    KiloCliDataParser.parseQuestionRequests(raw).map { request ->
                        questionOwner[request.id] = attachment.session
                        request.copy(sessionID = attachment.session)
                    }
                }
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

    private suspend fun ensure(id: String, organizationID: String?): Attachment {
        val (provider, workspace, native) = parse(id)
        lock.withLock {
            val now = System.currentTimeMillis()
            val existing = attachments[id]
            if (existing != null && existing.expiresAt - now > RENEW_WINDOW_MS) return existing
            if (existing != null) close(existing)
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
            log.info("hosted attach session=${ChatLogSummary.sid(id)} attachment=${attachment.id} expiresAt=$expires")
            return attachment
        }
    }

    private suspend fun <T> attached(id: String, organizationID: String?, block: suspend (Attachment) -> T): T {
        val (provider, workspace, _) = parse(id)
        var failure: Throwable? = null
        repeat(2) { attempt ->
            val attachment = ensure(id, organizationID)
            try {
                return block(attachment)
            } catch (e: HostedHttpException) {
                failure = e
                if (attempt == 0 && (e.code == 404 || e.code == 410)) {
                    log.info("hosted attachment expired session=${ChatLogSummary.sid(id)} code=${e.code} reattach=true")
                    close(attachment)
                    attachments.remove(id, attachment)
                    return@repeat
                }
                throw e
            } catch (e: ClientException) {
                failure = e
                if (attempt == 0 && e.statusCode in setOf(404, 410)) {
                    close(attachment)
                    attachments.remove(id, attachment)
                    return@repeat
                }
                throw e
            }
        }
        throw failure ?: IllegalStateException("Hosted session call failed for $provider/$workspace")
    }

    private fun startStreams(attachment: Attachment) {
        attachment.events = cs.launch(Dispatchers.IO) { eventLoop(attachment) }
        attachment.system = cs.launch(Dispatchers.IO) { systemLoop(attachment) }
    }

    private suspend fun eventLoop(attachment: Attachment) {
        val normalizer = KiloCliDataParser.ChatEventNormalizer()
        var backoff = INITIAL_BACKOFF_MS
        var connected = false
        while (started && attachments[attachment.session] === attachment) {
            val opened = stream(
                "/event?workspace=${encode(attachment.id)}",
                onOpen = {
                    if (connected) chat?.publish(ChatEventDto.Resnapshot(attachment.session))
                    connected = true
                    backoff = INITIAL_BACKOFF_MS
                },
            ) { type, data ->
                val kind = type ?: KiloCliDataParser.extractEventType(data)
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
                    chat?.publish(HostedEventMapper.event(event, attachment.session, attachment.ref.key))
                }
            }
            if (!started || attachments[attachment.session] !== attachment) return
            if (!opened) backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            if (System.currentTimeMillis() >= attachment.expiresAt - RENEW_WINDOW_MS) {
                runCatching { ensure(attachment.session, attachment.organizationID) }
                    .onFailure { log.warn("hosted reattach failed session=${ChatLogSummary.sid(attachment.session)} message=${it.message}") }
                if (attachments[attachment.session] !== attachment) return
            }
            delay(backoff)
        }
    }

    private suspend fun systemLoop(attachment: Attachment) {
        var backoff = INITIAL_BACKOFF_MS
        while (started && attachments[attachment.session] === attachment) {
            val opened = stream("/cloud-agent/event?workspace=${encode(attachment.id)}") { type, data ->
                parseSystem(attachment, type, data)?.let { _system.tryEmit(it) }
            }
            if (!started || attachments[attachment.session] !== attachment) return
            backoff = if (opened) INITIAL_BACKOFF_MS else (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            delay(backoff)
        }
    }

    /**
     * Opens one SSE stream and suspends until it closes. Returns whether the stream ever opened, so
     * the caller can distinguish a dropped connection from a route the provider does not serve.
     */
    private suspend fun stream(
        path: String,
        onOpen: () -> Unit = {},
        onEvent: (String?, String) -> Unit,
    ): Boolean {
        val client = http ?: return false
        val url = base ?: return false
        val source = java.util.concurrent.atomic.AtomicReference<EventSource?>(null)
        val done = kotlinx.coroutines.CompletableDeferred<Boolean>()
        val factory = EventSources.createFactory(
            client.newBuilder()
                .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build(),
        )
        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: okhttp3.Response) {
                source.set(eventSource)
                onOpen()
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                onEvent(type, data)
            }

            override fun onClosed(eventSource: EventSource) {
                done.complete(true)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                if (t != null) log.debug { "hosted stream closed path=$path message=${t.message}" }
                done.complete(response?.isSuccessful == true)
            }
        }
        val eventSource = factory.newEventSource(Request.Builder().url("$url$path").build(), listener)
        return try {
            done.await()
        } finally {
            (source.get() ?: eventSource).cancel()
        }
    }

    private fun parseSystem(attachment: Attachment, type: String?, data: String): HostedSystemEventDto? {
        val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return null
        val payload = obj["payload"]?.jsonObject ?: obj
        val props = payload["properties"]?.jsonObject ?: payload
        val kind = payload.string("type") ?: type ?: KiloCliDataParser.extractEventType(data)
        val native = props.string("sessionID") ?: attachment.native
        if (native != attachment.native) return null
        return HostedSystemEventDto(
            sessionID = attachment.session,
            kind = kind,
            step = props.string("step"),
            action = props.string("action"),
            message = props.string("message"),
            cloudStatus = props.string("cloudStatus") ?: props.string("status"),
            sandboxStatus = props.string("sandboxStatus"),
            sandboxDetail = props.string("sandboxDetail") ?: props.string("detailCode"),
            observedAt = props["observedAt"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 0.0,
        )
    }

    private fun close(attachment: Attachment) {
        attachment.events?.cancel()
        attachment.system?.cancel()
        attachment.events = null
        attachment.system = null
        _statuses.update { it - attachment.session }
        if (started) {
            cs.launch(Dispatchers.IO) {
                runCatching { requireApi().sessionHostDetach(attachment.id) }
                    .onFailure { log.debug { "hosted detach failed attachment=${attachment.id} message=${it.message}" } }
            }
        }
    }

    // ------ helpers ------

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

    private fun get(path: String, op: String): String? {
        val client = http ?: return null
        val url = base ?: return null
        val request = Request.Builder().url("$url$path").get().build()
        return client.newCall(request).execute().use { response ->
            val raw = response.body?.string()
            if (!response.isSuccessful) {
                if (response.code in setOf(404, 410)) throw HostedHttpException(response.code, "$op failed: HTTP ${response.code}")
                log.warn("hosted $op failed: HTTP ${response.code}")
                return null
            }
            raw
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
