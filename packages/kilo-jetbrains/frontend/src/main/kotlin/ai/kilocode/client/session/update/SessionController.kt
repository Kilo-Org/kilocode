package ai.kilocode.client.session.update

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.AgentItem
import ai.kilocode.client.session.model.ModelLimitItem
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
import ai.kilocode.rpc.dto.ConfigWarningDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.awt.Component

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
  comp: Component? = null,
  private val flushMs: Long = EVENT_FLUSH_MS,
  private val condense: Boolean = true,
  private val displayMs: Long = DISPLAY_DELAY_MS,
  session: SessionDto? = null,
  private val open: (SessionDto) -> Unit = {},
  private val beforeUpdate: () -> Boolean = { false },
  private val afterUpdate: (Boolean) -> Unit = {},
  private val loaded: (Boolean) -> Unit = {},
) : Disposable {

    companion object {
        private val LOG = KiloLog.create(SessionController::class.java)
        internal const val RECENT_LIMIT = 5
        internal const val DISPLAY_DELAY_MS = 1_000L
    }

    init {
        Disposer.register(parent, this)
    }

    val model = SessionModel()

    private val listeners = mutableListOf<SessionControllerListener>()
    private var sessionId: String? = session?.id ?: id
    private val initialSession = session
    private val directory: String get() = workspace.directory
    private val updates = SessionUpdateQueue(
      parent,
      comp,
      flushMs,
      ::handle,
      condense,
      id != null
    ) { sessionId ?: "pending" }

    private var partType: String? = null
    private var tool: String? = null
    private var eventJob: Job? = null
    private var historyState: HistoryState = HistoryState.Idle
    private var recentsState: RecentsState = RecentsState.Idle
    private var viewState: SessionControllerEvent.ViewChanged? = null
    private var connectionState: SessionControllerEvent.ConnectionChanged? = null
    private var connectionTargetState: SessionControllerEvent.ConnectionChanged? = null
    private val delayedState = DelayedState(displayMs)

    val ready: Boolean get() = model.isReady()
    internal val blank: Boolean get() = sessionId == null && model.isEmpty() && !model.showSession
    internal val id: String? get() = sessionId

    fun openSession(session: SessionDto) {
        assertEdt()
        open(session)
    }

    fun addListener(parent: Disposable, listener: SessionControllerListener) {
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
    }

    internal fun snapshotState(): ControllerStateSnapshot {
        assertEdt()
        return ControllerStateSnapshot(
            showSession = model.showSession,
            viewState = viewState,
            connectionState = connectionState,
            connectionTargetState = connectionTargetState,
            historyState = historyState.toString(),
            recentsState = recentsState.toString(),
        )
    }

    internal fun flushEvents() {
        assertEdt()
        updates.requestFlush(true)
    }

    fun prompt(text: String) {
        assertEdt()
        val sid = sessionId ?: "pending"
        val dto = promptDto(text)
        LOG.debug { "${ChatLogSummary.sid(sid)} ${ChatLogSummary.prompt(text)} ${ChatLogSummary.dir(directory)}" }
        showMessages()
        cs.launch {
            try {
                val id = sessionId ?: run {
                    val session = sessions.create(directory)
                    runEdt {
                        sessionId = session.id
                        updateModel {
                            model.setSession(session)
                        }
                    }
                    val meta = if (LOG.isDebugEnabled) ChatLogSummary.dir(directory) else "kind=session"
                    LOG.info("${ChatLogSummary.sid(session.id)} kind=session $meta created=true")
                    subscribeEvents()
                    session.id
                }
                sessions.prompt(id, directory, dto)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=prompt dispatched=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: sid)} kind=prompt dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    val msg = e.message ?: KiloBundle.message("session.error.prompt")
                    updateModel {
                        model.setState(SessionState.Error(msg))
                    }
                }
            }
        }
    }

    fun abort() {
        assertEdt()
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

    fun compact() {
        assertEdt()
        val id = sessionId ?: return
        if (model.state.isBusy()) return
        if (model.isEmpty()) return
        val parsed = model.model?.let(::parseModel) ?: return
        val sel = ModelSelectionDto(parsed.first, parsed.second)
        LOG.debug { "${ChatLogSummary.sid(id)} kind=compact model=${sel.providerID}/${sel.modelID}" }
        cs.launch {
            try {
                sessions.compact(id, directory, sel)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=compact ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=compact dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    updateModel {
                        model.setState(SessionState.Error(e.message ?: KiloBundle.message("session.error.compact")))
                    }
                }
            }
        }
    }

    fun retryConnection() {
        assertEdt()
        LOG.debug {
            "${ChatLogSummary.sid(sessionId ?: "pending")} kind=connection-retry app=${model.app.status} workspace=${model.workspace.status}"
        }
        setConnectionTargetState(SessionControllerEvent.ConnectionChanged.ShowConnecting)
        setVisibleConnectionState(SessionControllerEvent.ConnectionChanged.ShowConnecting)
        // App retry policy is backend-owned and may escalate from lightweight refresh to restart.
        if (model.app.status != KiloAppStatusDto.READY || model.app.status == KiloAppStatusDto.ERROR) {
            app.retryAsync()
            return
        }
        if (model.app.warnings.isNotEmpty()) {
            app.retryAsync()
            return
        }
        // Pure workspace failures stay scoped to workspace reload.
        if (model.workspace.status == KiloWorkspaceStatusDto.ERROR) {
            workspace.reload()
        }
    }

    fun selectAgent(name: String) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config agent=$name" }
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(agent = name))
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sessionId ?: "pending")} kind=config agent=$name dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
        fire(SessionControllerEvent.WorkspaceReady) {
            model.agent = name
            syncModelSelection()
        }
    }

    fun selectModel(provider: String, id: String) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config model=$provider/$id" }
        val agent = model.agent ?: return
        val key = "$provider/$id"
        if (item(key) == null && model.workspace.providers != null) return
        app.selectModel(agent, provider, id)
        selectResolvedModel(key)
        model.modelOverride = model.defaultModel != model.model
    }

    fun clearModelOverride() {
        assertEdt()
        val agent = model.agent ?: return
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config model-reset agent=$agent" }
        app.clearModel(agent)
        val auto = configModel(agent) ?: providerModel(agent)
        selectResolvedModel(auto)
        model.modelOverride = false
    }

    fun selectVariant(value: String) {
        assertEdt()
        val key = model.model ?: return
        if (value !in model.variants) return
        LOG.debug { "${ChatLogSummary.sid(sessionId ?: "pending")} kind=config variant=$key/$value" }
        app.selectVariant(key, value)
        model.variant = value
    }

    // ------ permission / question resolution ------

    fun replyPermission(requestId: String, reply: PermissionReplyDto, rules: PermissionAlwaysRulesDto? = null) {
        assertEdt()
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
        assertEdt()
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
        assertEdt()
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
        initialSession?.let { model.setSession(it) }
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
                    syncModelSelection()
                    syncConnectionState()
                }
            }
        }

        cs.launch {
            app.models.drop(1).collect {
                fire(SessionControllerEvent.WorkspaceReady) {
                    syncModelSelection()
                }
            }
        }

        cs.launch {
            workspace.state.collect { state ->
                fire(SessionControllerEvent.WorkspaceChanged) {
                    model.workspace = state
                    syncConnectionState()

                    if (state.status != KiloWorkspaceStatusDto.READY) return@fire

                    model.agents = state.agents?.agents?.map {
                        AgentItem(
                            it.name,
                            it.displayName ?: title(it.name),
                            it.description,
                            it.deprecated == true,
                        )
                    } ?: emptyList()

                    model.models = state.providers?.let { providers ->
                        providers.providers
                            .filter { it.id == KILO_PROVIDER || it.id in providers.connected }
                            .flatMap { provider ->
                                provider.models.map { (id, info) ->
                                    ModelItem(
                                        id,
                                        info.name,
                                        provider.id,
                                        provider.name,
                                        info.recommendedIndex,
                                        info.free,
                                        info.variants,
                                        info.limit?.let { ModelLimitItem(it.context, it.input, it.output) },
                                    )
                                }
                            }
                    } ?: emptyList()

                    if (this@SessionController.model.agent == null) {
                        this@SessionController.model.agent = state.agents?.default
                    }
                    syncModelSelection()
                    model.refreshHeader()
                }

                if (state.status == KiloWorkspaceStatusDto.READY) {
                    fire(SessionControllerEvent.WorkspaceReady)
                    edt {
                        if (sessionId == null) refreshRecents()
                    }
                }
            }
        }
    }

    private fun loadHistory() {
        val id = sessionId ?: return
        cs.launch {
            val state = HistoryState.Loading()
            runEdt {
                setHistoryState(state)
            }
            delayedState.run(state, { historyState }) {
                if (!model.showSession) setControllerViewState(SessionControllerEvent.ViewChanged.ShowProgress)
            }
            try {
                val session = initialSession ?: runCatching { sessions.get(id, directory) }.getOrNull()
                val items = sessions.messages(id, directory)
                LOG.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(items)}" }
                runEdt {
                    updateModel {
                        this@SessionController.model.loadHistory(items)
                        if (session != null) this@SessionController.model.setSession(session)
                    }
                }
                recoverPending(id)
                runEdt {
                    val show = !model.isEmpty()
                    if (show) showMessages()
                    if (!show) refreshRecents(force = true)
                    loaded(show)
                }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=history dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    refreshRecents(force = true)
                    loaded(false)
                }
            } finally {
                edt {
                    if (historyState != state) return@edt
                    setHistoryState(HistoryState.Idle)
                }
                updates.holdFlush(false)
                updates.requestFlush(true)
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
                    updates.enqueue(event)
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
            runEdt {
                updateModel {
                    if (permissions.isNotEmpty()) {
                        model.setState(SessionState.AwaitingPermission(toPermission(permissions.last())))
                    } else if (questions.isNotEmpty()) {
                        model.setState(SessionState.AwaitingQuestion(toQuestion(questions.last())))
                    } else if (status != null) {
                        seedStatus(status)
                    }
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

            is ChatEventDto.SessionUpdated -> model.setSession(event.session)

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

    private fun promptDto(text: String): PromptDto {
        val full = model.model
        val sel = full?.let(::parseModel)
        val variant = model.variant?.takeIf { it in model.variants }
        return PromptDto(
            parts = listOf(PromptPartDto(type = "text", text = text)),
            providerID = sel?.first,
            modelID = sel?.second,
            agent = model.agent,
            variant = variant,
        )
    }

    private fun syncModelSelection() {
        val agent = model.agent ?: return
        val auto = configModel(agent) ?: providerModel(agent)
        val selected = selectedModel(agent, auto)
        model.defaultModel = auto
        selectResolvedModel(selected)
        model.modelOverride = selected != auto
    }

    private fun selectedModel(agent: String, auto: String?): String? {
        val saved = app.models.value.model[agent]
        val cfg = model.app.config
        if (cfg != null) return resolveModelSelection(
            providers = model.workspace.providers,
            override = saved,
            mode = cfg.agent[agent]?.model?.let(::selection),
            global = cfg.model?.let(::selection),
            recent = app.models.value.recent,
        )?.key
        if (saved != null) return valid(model.workspace.providers, saved)?.key ?: auto
        return auto
    }

    private fun configModel(agent: String): String? {
        if (model.app.status != KiloAppStatusDto.READY) return null
        val cfg = model.app.config
        return resolveModelSelection(
            providers = model.workspace.providers,
            mode = cfg?.agent?.get(agent)?.model?.let(::selection),
            global = cfg?.model?.let(::selection),
            recent = app.models.value.recent,
        )?.key
    }

    private fun providerModel(agent: String): String? {
        val providers = model.workspace.providers ?: return null
        return resolveModelSelection(
            providers = providers,
            mode = providers.defaults[agent]?.let(::selection),
            global = providers.defaults.values.firstNotNullOfOrNull(::selection),
            fallback = null,
        )?.key ?: model.models.firstOrNull()?.key
    }

    private fun selectResolvedModel(key: String?) {
        model.model = key
        val item = key?.let(::item)
        model.variants = item?.variants ?: emptyList()
        val saved = key?.let { app.models.value.variant[it] }
        model.variant = saved?.takeIf { it in model.variants } ?: model.variants.firstOrNull()
        model.refreshHeader()
    }

    private fun item(key: String): ModelItem? = model.models.firstOrNull { it.key == key }

    private fun handle(events: List<ChatEventDto>) {
        updateModel {
            for (event in events) handle(event)
        }
    }

    private fun updateModel(block: () -> Unit) {
        assertEdt()
        val follow = beforeUpdate()
        block()
        afterUpdate(follow)
    }

    private fun showMessages() {
        assertEdt()
        if (!model.showSession) {
            setControllerViewState(SessionControllerEvent.ViewChanged.ShowSession)
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

    fun refreshRecents(force: Boolean = false) {
        assertEdt()
        if (model.showSession) return
        if (recentsState is RecentsState.Loading) return
        if (recentsState is RecentsState.Loaded && !force) return
        val state = RecentsState.Loading()
        setRecentSessionsState(state)
        delayedState.run(state, { recentsState }) {
            setControllerViewState(SessionControllerEvent.ViewChanged.ShowProgress)
        }
        cs.launch {
            try {
                val items = sessions.recent(directory, RECENT_LIMIT)
                edt {
                    if (recentsState != state) return@edt
                    setRecentSessionsState(RecentsState.Loaded)
                    if (model.showSession) return@edt
                    setControllerViewState(SessionControllerEvent.ViewChanged.ShowRecents(items))
                }
            } catch (e: Exception) {
                LOG.warn("kind=session-recent dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (recentsState != state) return@edt
                    setRecentSessionsState(RecentsState.Loaded)
                    if (model.showSession) return@edt
                    setControllerViewState(SessionControllerEvent.ViewChanged.ShowRecents(emptyList()))
                }
            }
        }
    }

    private fun setControllerViewState(event: SessionControllerEvent.ViewChanged) {
        assertEdt()
        if (viewState == event) return
        fire(event) {
            viewState = event
            if (event is SessionControllerEvent.ViewChanged.ShowSession) {
                model.showSession = true
                setHistoryState(HistoryState.Idle)
                setRecentSessionsState(RecentsState.Idle)
            }
        }
    }

    private fun setConnectionTargetState(event: SessionControllerEvent.ConnectionChanged) {
        assertEdt()
        connectionTargetState = event
        val state = event
        if (event is SessionControllerEvent.ConnectionChanged.Hide || event is SessionControllerEvent.ConnectionChanged.ShowWarning) {
            setVisibleConnectionState(event)
            return
        }
        if (connectionState == event) {
            return
        }
        delayedState.run(event, { if (connectionTargetState == state) state else resolveConnectionState() }, ::setVisibleConnectionState)
    }

    private fun setVisibleConnectionState(event: SessionControllerEvent.ConnectionChanged) {
        assertEdt()
        if (connectionState == event) return
        if (connectionState == null && event is SessionControllerEvent.ConnectionChanged.Hide) {
            connectionState = event
            return
        }
        fire(event) {
            connectionState = event
        }
    }

    private fun syncConnectionState() {
        assertEdt()
        setConnectionTargetState(resolveConnectionState())
    }

    private fun setHistoryState(state: HistoryState) {
        assertEdt()
        historyState = state
    }

    private fun setRecentSessionsState(state: RecentsState) {
        assertEdt()
        recentsState = state
    }

    private fun resolveConnectionState(): SessionControllerEvent.ConnectionChanged {
        assertEdt()
        val app = model.app
        val workspace = model.workspace

        if (app.status == KiloAppStatusDto.ERROR) {
            return SessionControllerEvent.ConnectionChanged.ShowError(
                KiloBundle.message("session.connection.error.app"),
                app.errors.toErrorText() ?: app.error,
            )
        }

        if (workspace.status == KiloWorkspaceStatusDto.ERROR) {
            return SessionControllerEvent.ConnectionChanged.ShowError(
                KiloBundle.message("session.connection.error.workspace"),
                workspace.errors.toErrorText() ?: workspace.error,
                "workspace",
            )
        }

        if (app.status == KiloAppStatusDto.READY && workspace.status == KiloWorkspaceStatusDto.READY && app.warnings.isNotEmpty()) {
            return SessionControllerEvent.ConnectionChanged.ShowWarning(
                summary(app.warnings.size),
                app.warnings.toWarningText(),
            )
        }

        if (app.status == KiloAppStatusDto.READY && workspace.status == KiloWorkspaceStatusDto.READY) {
            return SessionControllerEvent.ConnectionChanged.Hide
        }

        return SessionControllerEvent.ConnectionChanged.ShowConnecting
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

    private fun assertEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "SessionController state must be accessed on EDT" }
    }

    private fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(block)
    }

    private fun runEdt(block: () -> Unit) {
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) {
            block()
            return
        }
        application.invokeAndWait(block)
    }

    override fun dispose() {
        delayedState.dispose()
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
    is ChatEventDto.SessionUpdated -> event.sessionID == id
    is ChatEventDto.SessionIdle -> event.sessionID == id
    is ChatEventDto.SessionCompacted -> event.sessionID == id
    is ChatEventDto.SessionDiffChanged -> event.sessionID == id
    is ChatEventDto.TodoUpdated -> event.sessionID == id
}

private fun summary(count: Int): String {
    val base = KiloBundle.message("session.connection.warning.config")
    if (count <= 1) return base
    return "$base ($count)"
}

private fun title(name: String): String = name
    .split('-', '_')
    .filter { it.isNotEmpty() }
    .joinToString(" ") { it.replaceFirstChar { c -> c.titlecase() } }
    .ifEmpty { name }

private const val KILO_PROVIDER = "kilo"
private const val KILO_AUTO_MODEL = "kilo-auto/free"

private fun resolveModelSelection(
    providers: ProvidersDto?,
    override: ModelSelectionDto? = null,
    mode: ModelSelectionDto? = null,
    global: ModelSelectionDto? = null,
    recent: List<ModelSelectionDto> = emptyList(),
    fallback: ModelSelectionDto? = ModelSelectionDto(KILO_PROVIDER, KILO_AUTO_MODEL),
): ModelSelectionDto? {
    valid(providers, override)?.let { return it }
    valid(providers, mode)?.let { return it }
    valid(providers, global)?.let { return it }
    recent.firstNotNullOfOrNull { valid(providers, it) }?.let { return it }
    return fallback
}

private fun valid(providers: ProvidersDto?, item: ModelSelectionDto?): ModelSelectionDto? {
    if (item == null) return null
    val list = providers?.providers ?: return item
    if (list.isEmpty()) return item
    val provider = list.firstOrNull { it.id == item.providerID } ?: return null
    if (item.providerID != KILO_PROVIDER && item.providerID !in providers.connected) return null
    if (item.modelID !in provider.models) return null
    return item
}

private val ModelSelectionDto.key: String get() = "$providerID/$modelID"

private fun selection(value: String): ModelSelectionDto? {
    val parsed = parseModel(value) ?: return null
    return ModelSelectionDto(parsed.first, parsed.second)
}

private fun parseModel(value: String): Pair<String, String>? {
    val slash = value.indexOf('/')
    if (slash <= 0 || slash >= value.length - 1) return null
    return value.substring(0, slash) to value.substring(slash + 1)
}

private sealed interface RecentsState {
    data object Idle : RecentsState
    data class Loading(val id: Any = Any()) : RecentsState
    data object Loaded : RecentsState
}

private sealed interface HistoryState {
    data object Idle : HistoryState
    data class Loading(val id: Any = Any()) : HistoryState
}

internal data class ControllerStateSnapshot(
    val showSession: Boolean,
    val viewState: SessionControllerEvent.ViewChanged?,
    val connectionState: SessionControllerEvent.ConnectionChanged?,
    val connectionTargetState: SessionControllerEvent.ConnectionChanged?,
    val historyState: String,
    val recentsState: String,
)

private fun List<LoadErrorDto>.toErrorText(): String? {
    val out = mapNotNull { it.toDetailLine() }
    if (out.isEmpty()) return null
    return out.joinToString("\n")
}

private fun List<ConfigWarningDto>.toWarningText(): String? {
    val out = mapNotNull { it.toDetailLine() }
    if (out.isEmpty()) return null
    return out.joinToString("\n\n")
}

private fun LoadErrorDto.toDetailLine(): String? {
    val detail = detail?.trim()?.ifEmpty { null } ?: return null
    if (resource == "connection") return detail
    return "$resource: $detail"
}

private fun ConfigWarningDto.toDetailLine(): String {
    val head = "$path: $message"
    val tail = detail?.trim()?.ifEmpty { null } ?: return head
    return "$head\n$tail"
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
