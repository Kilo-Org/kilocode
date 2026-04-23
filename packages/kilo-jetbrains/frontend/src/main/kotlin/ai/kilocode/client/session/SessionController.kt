package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.AgentItem
import ai.kilocode.client.session.model.ModelItem
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Session lifecycle orchestrator for a single session.
 *
 * Accepts an optional [id] — if non-null, loads that session immediately.
 * If null, lazily creates a session on the first [prompt] call. This ensures
 * event subscription happens before the prompt is sent, eliminating races.
 *
 * Owns [SessionModel] — the single source of truth for session content and
 * state. UIs observe model changes via [SessionModelEvent] on [model].
 * Lifecycle events (app/workspace state, view switching) are published
 * via [SessionControllerEvent] to registered listeners.
 */
class SessionController(
    parent: Disposable,
    id: String?,
    private val sessions: KiloSessionService,
    private val workspace: Workspace,
    private val app: KiloAppService,
    private val cs: CoroutineScope,
) : Disposable {

    companion object {
        private val LOG = KiloLog.create(SessionController::class.java)
    }

    init {
        Disposer.register(parent, this)
    }

    val model = SessionModel()

    private val listeners = mutableListOf<SessionControllerListener>()
    private var sessionId: String? = id
    private val directory: String get() = workspace.directory

    private var partType: String? = null
    private var tool: String? = null
    private var eventJob: Job? = null

    val ready: Boolean get() = model.isReady()

    fun addListener(parent: Disposable, listener: SessionControllerListener) {
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
    }

    fun prompt(text: String) {
        val sid = sessionId ?: "pending"
        LOG.debug { "${ChatLogSummary.sid(sid)} ${ChatLogSummary.prompt(text)} ${ChatLogSummary.dir(directory)}" }
        showMessages()
        cs.launch {
            try {
                val id = sessionId ?: run {
                    val session = sessions.create(directory)
                    sessionId = session.id
                    val meta = if (LOG.isDebugEnabled) ChatLogSummary.dir(directory) else "kind=session"
                    LOG.info("${ChatLogSummary.sid(session.id)} kind=session $meta created=true")
                    subscribeEvents()
                    session.id
                }
                sessions.prompt(id, directory, text)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=prompt dispatched=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: sid)} kind=prompt dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    val msg = e.message ?: KiloBundle.message("session.error.prompt")
                    model.setState(SessionState.Error(msg))
                }
            }
        }
    }

    fun abort() {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=abort" }
        val id = sessionId ?: return
        cs.launch {
            try {
                sessions.abort(id, directory)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=abort ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=abort dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    fun selectAgent(name: String) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config agent=$name" }
        model.agent = name
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(agent = name))
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=config agent=$name dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
        fire(SessionControllerEvent.WorkspaceReady)
    }

    fun selectModel(provider: String, id: String) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config model=$provider/$id" }
        model.model = "$provider/$id"
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(model = "$provider/$id"))
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=config model=$provider/$id dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
        fire(SessionControllerEvent.WorkspaceReady)
    }

    // ------ permission / question resolution ------

    fun replyPermission(requestId: String, reply: PermissionReplyDto, rules: PermissionAlwaysRulesDto? = null) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=permission rid=$requestId reply=${reply.reply}" }
        cs.launch {
            try {
                if (rules != null) sessions.savePermissionRules(requestId, directory, rules)
                sessions.replyPermission(requestId, directory, reply)
                LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=permission rid=$requestId ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=permission rid=$requestId reply=${reply.reply} dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    fun replyQuestion(requestId: String, answers: QuestionReplyDto) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId answers=${answers.answers.size}" }
        cs.launch {
            try {
                sessions.replyQuestion(requestId, directory, answers)
                LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId answers=${answers.answers.size} dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    fun rejectQuestion(requestId: String) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId rejected=true" }
        cs.launch {
            try {
                sessions.rejectQuestion(requestId, directory)
                LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=question rid=$requestId rejected=true dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    init {
        if (sessionId != null) {
            loadHistory()
            subscribeEvents()
        }

        model.addListener(this) { event ->
            LOG.debug { "session=$sessionId model: $event" }
        }

        app.connect()
        cs.launch {
            app.state.collect { state ->
                if (state.status == KiloAppStatusDto.READY) app.fetchVersionAsync()
                fire(SessionControllerEvent.AppChanged) {
                    model.app = state
                    model.version = app.version
                }
            }
        }

        cs.launch {
            workspace.state.collect { state ->
                fire(SessionControllerEvent.WorkspaceChanged) {
                    model.workspace = state

                    if (state.status != KiloWorkspaceStatusDto.READY) return@fire

                    model.agents = state.agents?.agents?.map {
                        AgentItem(it.name, it.displayName ?: it.name)
                    } ?: emptyList()

                    model.models = state.providers?.let { providers ->
                        providers.providers
                            .filter { it.id in providers.connected }
                            .flatMap { provider ->
                                provider.models.map { (id, info) ->
                                    ModelItem(id, info.name, provider.id)
                                }
                            }
                    } ?: emptyList()

                    if (this@SessionController.model.agent == null) this@SessionController.model.agent = state.agents?.default
                    if (this@SessionController.model.model == null) {
                        this@SessionController.model.model = state.providers?.defaults?.entries?.firstOrNull()?.let { "${it.key}/${it.value}" }
                    }
                }

                if (state.status == KiloWorkspaceStatusDto.READY) {
                    fire(SessionControllerEvent.WorkspaceReady)
                }
            }
        }
    }

    private fun loadHistory() {
        val id = sessionId ?: return
        cs.launch {
            try {
                val history = sessions.messages(id, directory)
                LOG.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(history)}" }
                edt {
                    this@SessionController.model.loadHistory(history)
                    if (!model.isEmpty()) showMessages()
                }
                recoverPending(id)
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=history dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    private fun subscribeEvents() {
        val id = sessionId ?: return
        LOG.debug { "${ChatLogSummary.sid(id)} kind=subscription subscribe=true" }
        eventJob?.cancel()
        eventJob = cs.launch {
            try {
                sessions.events(id, directory).collect { event ->
                    if (!matchesSession(event, id)) {
                        LOG.debug { "${ChatLogSummary.sid(id)} pass=false ${ChatLogSummary.eventBody(event)}" }
                        return@collect
                    }
                    LOG.debug { "${ChatLogSummary.sid(id)} pass=true ${ChatLogSummary.eventBody(event)}" }
                    edt { handle(event) }
                }
            } finally {
                LOG.debug { "${ChatLogSummary.sid(id)} kind=subscription subscribe=false" }
            }
        }
    }

    /** Rehydrate pending permissions/questions and current session status after history load. */
    private suspend fun recoverPending(id: String) {
        try {
            val permissions = sessions.pendingPermissions(directory).filter { it.sessionID == id }
            val questions = sessions.pendingQuestions(directory).filter { it.sessionID == id }
            val status = sessions.statuses.value[id]
            val branch = when {
                permissions.isNotEmpty() -> "permission"
                questions.isNotEmpty() -> "question"
                status != null -> "status"
                else -> "idle"
            }
            LOG.debug {
                "${ChatLogSummary.sid(id)} kind=recovery permissions=${permissions.size} questions=${questions.size} status=${status?.type ?: "none"} branch=$branch"
            }
            edt {
                if (permissions.isNotEmpty()) {
                    model.setState(SessionState.AwaitingPermission(toPermission(permissions.last())))
                } else if (questions.isNotEmpty()) {
                    model.setState(SessionState.AwaitingQuestion(toQuestion(questions.last())))
                } else if (status != null) {
                    seedStatus(status)
                }
            }
        } catch (e: Exception) {
            LOG.warn("${ChatLogSummary.sid(id)} kind=recovery dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
        }
    }

    /**
     * Seed initial session state from a snapshot status value.
     *
     * Used only during recovery — does not apply the live-event clobbering guard
     * for "busy" because no more-specific state has arrived yet.
     */
    private fun seedStatus(dto: SessionStatusDto) {
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} evt=session.status ${ChatLogSummary.status(dto)}" }
        val state = when (dto.type) {
            "busy" -> SessionState.Busy(KiloBundle.message("session.status.considering"))
            "retry" -> SessionState.Retry(
                message = dto.message ?: "",
                attempt = dto.attempt ?: 0,
                next = dto.next ?: 0L,
            )
            "offline" -> SessionState.Offline(
                message = dto.message ?: "",
                requestId = dto.requestID ?: "",
            )
            else -> return  // idle or unknown — leave as Idle
        }
        model.setState(state)
    }

    private fun handle(event: ChatEventDto) {
        LOG.debug { ChatLogSummary.event(event) }
        when (event) {
            is ChatEventDto.MessageUpdated -> {
                val added = model.upsertMessage(event.info)
                if (added) showMessages()
            }

            is ChatEventDto.PartUpdated -> {
                partType = event.part.type
                tool = event.part.tool
                model.updateContent(event.part.messageID, event.part)
                if (model.state is SessionState.Busy) {
                    model.setState(SessionState.Busy(status()))
                }
            }

            is ChatEventDto.PartDelta -> {
                if (event.field == "text") {
                    model.appendDelta(event.messageID, event.partID, event.delta)
                }
            }

            is ChatEventDto.PartRemoved -> {
                model.removeContent(event.messageID, event.partID)
            }

            is ChatEventDto.TurnOpen -> {
                partType = null
                tool = null
                model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
            }

            is ChatEventDto.TurnClose -> {
                partType = null
                tool = null
                // "completed" always transitions to idle.
                // Other reasons: don't clobber a more specific terminal state (Error,
                // AwaitingPermission, AwaitingQuestion) that arrived just before close.
                val current = model.state
                val clobberOk = event.reason == "completed"
                    || current is SessionState.Busy
                    || current is SessionState.Retry
                    || current is SessionState.Offline
                if (clobberOk) model.setState(SessionState.Idle)
            }

            is ChatEventDto.Error -> {
                partType = null
                tool = null
                val msg = event.error?.message ?: event.error?.type ?: KiloBundle.message("session.error.unknown")
                model.setState(SessionState.Error(msg, event.error?.type))
            }

            is ChatEventDto.MessageRemoved -> {
                model.removeMessage(event.messageID)
            }

            is ChatEventDto.PermissionAsked -> {
                model.setState(SessionState.AwaitingPermission(toPermission(event.request)))
            }

            is ChatEventDto.PermissionReplied -> {
                val current = model.state
                if (current is SessionState.AwaitingPermission && current.permission.id == event.requestID) {
                    model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
                }
            }

            is ChatEventDto.QuestionAsked -> {
                model.setState(SessionState.AwaitingQuestion(toQuestion(event.request)))
            }

            is ChatEventDto.QuestionReplied -> {
                val current = model.state
                if (current is SessionState.AwaitingQuestion && current.question.id == event.requestID) {
                    model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
                }
            }

            is ChatEventDto.QuestionRejected -> {
                val current = model.state
                if (current is SessionState.AwaitingQuestion && current.question.id == event.requestID) {
                    model.setState(SessionState.Idle)
                }
            }

            is ChatEventDto.SessionStatusChanged -> {
                val state = when (event.status.type) {
                    "idle" -> SessionState.Idle
                    "busy" -> {
                        val current = model.state
                        if (current is SessionState.Idle || current is SessionState.Error)
                            SessionState.Busy(KiloBundle.message("session.status.considering"))
                        else return // already in a more specific phase
                    }
                    "retry" -> SessionState.Retry(
                        message = event.status.message ?: "",
                        attempt = event.status.attempt ?: 0,
                        next = event.status.next ?: 0L,
                    )
                    "offline" -> SessionState.Offline(
                        message = event.status.message ?: "",
                        requestId = event.status.requestID ?: "",
                    )
                    else -> return
                }
                model.setState(state)
            }

            is ChatEventDto.SessionIdle -> {
                // Treat session.idle as an explicit signal to return to Idle.
                // Only apply if we're not in a more specific non-terminal state.
                val current = model.state
                if (current !is SessionState.Error
                    && current !is SessionState.AwaitingPermission
                    && current !is SessionState.AwaitingQuestion
                ) {
                    model.setState(SessionState.Idle)
                }
            }

            is ChatEventDto.SessionCompacted -> model.markCompacted()
            is ChatEventDto.SessionDiffChanged -> model.setDiff(event.diff)
            is ChatEventDto.TodoUpdated -> model.setTodos(event.todos)
        }
    }

    private fun showMessages() {
        if (!model.showMessages) {
            model.showMessages = true
            fire(SessionControllerEvent.ViewChanged(true))
        }
    }

    private fun status(): String = when (partType) {
        "reasoning" -> KiloBundle.message("session.status.thinking")
        "text" -> KiloBundle.message("session.status.writing")
        "tool" -> when (tool) {
            "task" -> KiloBundle.message("session.status.delegating")
            "todowrite", "todoread" -> KiloBundle.message("session.status.planning")
            "read" -> KiloBundle.message("session.status.gathering")
            "glob", "grep", "list" -> KiloBundle.message("session.status.searching.codebase")
            "webfetch", "websearch", "codesearch" -> KiloBundle.message("session.status.searching.web")
            "edit", "write" -> KiloBundle.message("session.status.editing")
            "bash" -> KiloBundle.message("session.status.commands")
            else -> KiloBundle.message("session.status.considering")
        }
        else -> KiloBundle.message("session.status.considering")
    }

    private fun fire(event: SessionControllerEvent, before: (() -> Unit)? = null) {
        LOG.debug { "session=$sessionId controller: $event" }
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) {
            before?.invoke()
            for (l in listeners) l.onEvent(event)
            return
        }
        application.invokeLater {
            before?.invoke()
            for (l in listeners) l.onEvent(event)
        }
    }

    private fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(block)
    }

    override fun dispose() {
        eventJob?.cancel()
        cs.cancel()
    }

    override fun toString(): String {
        val out = mutableListOf<String>()
        val body = model.toString().trim()
        if (body.isNotEmpty()) out.add(body)
        if (out.isNotEmpty()) out.add("")
        out.add(statusLine())
        return out.joinToString("\n")
    }

    private fun statusLine(): String {
        val out = mutableListOf<String>()
        model.agent?.takeIf { it.isNotBlank() }?.let { out.add("[$it]") }
        model.model?.takeIf { it.isNotBlank() }?.let { out.add("[$it]") }

        if (!ready) {
            out.add("[app: ${model.app.status}]")
            out.add("[workspace: ${model.workspace.status}]")
            return out.joinToString(" ")
        }

        when (val state = model.state) {
            is SessionState.Idle -> out.add("[idle]")
            is SessionState.Busy -> {
                out.add("[busy]")
                out.add("[${state.text.toDumpText()}]")
            }
            is SessionState.AwaitingQuestion -> out.add("[awaiting-question]")
            is SessionState.AwaitingPermission -> out.add("[awaiting-permission]")
            is SessionState.Retry -> {
                out.add("[retry]")
                state.message.takeIf { it.isNotBlank() }?.let { out.add("[$it]") }
            }
            is SessionState.Offline -> {
                out.add("[offline]")
                state.message.takeIf { it.isNotBlank() }?.let { out.add("[$it]") }
            }
            is SessionState.Error -> {
                out.add("[error]")
                out.add("[${state.message}]")
            }
        }

        return out.joinToString(" ")
    }
}

/** Returns true when [event]'s sessionID matches [id] (or event has no sessionID, like Error). */
private fun matchesSession(event: ChatEventDto, id: String): Boolean = when (event) {
    is ChatEventDto.MessageUpdated -> event.sessionID == id
    is ChatEventDto.PartUpdated -> event.sessionID == id
    is ChatEventDto.PartDelta -> event.sessionID == id
    is ChatEventDto.PartRemoved -> event.sessionID == id
    is ChatEventDto.TurnOpen -> event.sessionID == id
    is ChatEventDto.TurnClose -> event.sessionID == id
    is ChatEventDto.Error -> event.sessionID == null || event.sessionID == id
    is ChatEventDto.MessageRemoved -> event.sessionID == id
    is ChatEventDto.PermissionAsked -> event.sessionID == id
    is ChatEventDto.PermissionReplied -> event.sessionID == id
    is ChatEventDto.QuestionAsked -> event.sessionID == id
    is ChatEventDto.QuestionReplied -> event.sessionID == id
    is ChatEventDto.QuestionRejected -> event.sessionID == id
    is ChatEventDto.SessionStatusChanged -> event.sessionID == id
    is ChatEventDto.SessionIdle -> event.sessionID == id
    is ChatEventDto.SessionCompacted -> event.sessionID == id
    is ChatEventDto.SessionDiffChanged -> event.sessionID == id
    is ChatEventDto.TodoUpdated -> event.sessionID == id
}

private fun toPermission(dto: PermissionRequestDto): Permission {
    val ref = dto.tool?.let { ToolCallRef(it.messageID, it.callID) }
    val file = dto.metadata["file"] ?: dto.metadata["path"]
    val state = dto.metadata["state"]?.let { raw ->
        PermissionRequestState.values().firstOrNull { item -> item.name.equals(raw, ignoreCase = true) }
    } ?: PermissionRequestState.PENDING
    return Permission(
        id = dto.id,
        sessionId = dto.sessionID,
        name = dto.permission,
        patterns = dto.patterns,
        always = dto.always,
        meta = PermissionMeta(filePath = file, raw = dto.metadata),
        tool = ref,
        state = state,
    )
}

private fun toQuestion(dto: QuestionRequestDto): Question {
    val ref = dto.tool?.let { ToolCallRef(it.messageID, it.callID) }
    val items = dto.questions.map {
        QuestionItem(
            question = it.question,
            header = it.header,
            options = it.options.map { opt -> QuestionOption(opt.label, opt.description) },
            multiple = it.multiple,
            custom = it.custom,
        )
    }
    return Question(id = dto.id, items = items, tool = ref)
}

private fun String.toDumpText(): String {
    val text = lowercase()
        .replace("\u2026", "")
        .replace("…", "")
        .replace(Regex("[^a-z0-9]+"), " ")
        .trim()
    return text
}
