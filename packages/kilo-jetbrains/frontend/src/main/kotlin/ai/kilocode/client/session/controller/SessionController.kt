package ai.kilocode.client.session.controller

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
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.PermissionRuleCandidate
import ai.kilocode.client.session.model.PermissionRuleDecision
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.ToolCallRef
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigWarningDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PermissionRuleDecisionDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.actionSystem.IdeActions
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import java.awt.Component
import java.nio.file.Path

/**
 * Session lifecycle orchestrator for a single session.
 *
 * Accepts an optional [ref] — if non-null, loads that session immediately.
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
  ref: SessionRef? = null,
  private val sessions: KiloSessionService,
  private val workspace: Workspace,
  private val app: KiloAppService,
  private val cs: CoroutineScope,
  private val comp: Component? = null,
  private val flushMs: Long = EVENT_FLUSH_MS,
  private val condense: Boolean = true,
  private val displayMs: Long = DISPLAY_DELAY_MS,
  private val revertTimeoutMs: Long = REVERT_TIMEOUT_MS,
  private val open: (SessionRef) -> Unit = {},
  private val beforeUpdate: () -> Boolean = { false },
  private val afterUpdate: (Boolean) -> Unit = {},
  private val loaded: (Boolean) -> Unit = {},
  private val openProfileAction: () -> Unit = {},
  private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
  private val timers: UiTimerSource = UiTimers,
  private val log: KiloLog = LOG,
) : Disposable {

    private data class OrganizationTarget(val org: String?)
    private data class Followup(val dir: String, val time: Long)
    private data class Pref(val agent: String?, val model: String?, val variants: List<String>, val variant: String?, val reset: Boolean)
    private data class RevertOp(val key: Long)
    private data class Dispatch(
        val kind: String,
        val source: String,
        val text: String,
        val props: Map<String, String>,
        val start: String,
        val exists: Boolean,
    )

    companion object {
        private val LOG = KiloLog.create(SessionController::class.java)
        internal const val RECENT_LIMIT = 5
        internal const val DISPLAY_DELAY_MS = 1_000L
        internal const val REVERT_TIMEOUT_MS = 30_000L
        private const val FOLLOWUP_TTL_MS = 30_000L
        private const val FOLLOWUP_NEW_SESSION = "Start new session"
    }

    init {
        Disposer.register(parent, this)
    }

    val model = SessionModel()

    private val listeners = mutableListOf<SessionControllerListener>()
    private var ref: SessionRef? = ref
    private val sid: String? get() = (ref as? SessionRef.Local)?.id
    private val directory: String get() = workspace.directory
    private val updates = SessionUpdateQueue(
      parent,
      cs,
      comp,
      flushMs,
      ::handle,
      condense,
      ref != null,
      ::handleHidden,
    ) { sid ?: ref?.key ?: "pending" }

    private var disposed = false
    private var enhancement = 0L
    private val enhancements = mutableMapOf<Long, (Result<String>) -> Unit>()
    private var partType: String? = null
    private var tool: String? = null
    private var eventJob: Job? = null
    private var drainJob: Job? = null
    private var revertJob: Job? = null
    private var revertOp: RevertOp? = null
    private var revertSeq = 0L
    private var revertWatchdog: UiTimer? = null
    // While a revert is in flight, turn/status transitions are deferred here instead of dropped,
    // then reconciled when the operation releases so an underlying server turn is not lost.
    private var revertDeferred: SessionState? = null
    private var creating: CompletableDeferred<String?>? = null
    private val childJobs: MutableMap<String, Job> = mutableMapOf()
    private val childIds: MutableSet<String> = mutableSetOf()
    private val childParts: MutableMap<PartKey, String> = mutableMapOf()
    private var sessionLoadState: SessionLoadState = SessionLoadState.Idle
    private var recentsState: RecentsState = RecentsState.Idle
    private var viewState: SessionControllerEvent.ViewChanged? = null
    private var connectionState: SessionControllerEvent.ConnectionChanged? = null
    private var connectionTargetState: SessionControllerEvent.ConnectionChanged? = null
    private val connectionDelay = DelayedState(displayMs, timers)
    private var acctState: SessionControllerEvent.AccountOverlayChanged =
        SessionControllerEvent.AccountOverlayChanged.Hide
    private var acctAllowed = false
    private var lastProfile: ProfileDto? = null
    private var target: OrganizationTarget? = null
    private var loginRetry: PromptDto? = null
    private var followup: Followup? = null
    private var agentTime: Double? = null
    private var prefModel: String? = null
    private var prefAgent: String? = null
    private var modelTime: Double? = null
    private val snapshots = mutableMapOf<PartKey, String>()

    val ready: Boolean get() = model.isReady()
    val autoApprove: Boolean get() = KiloPluginSettings.getAutoApprove()
    internal val blank: Boolean get() = ref == null && model.isEmpty() && !model.showSession
    internal val id: String? get() = sid
    internal val refKey: String? get() = ref?.key
    internal val refType: SessionRef.Type? get() = ref?.type

    fun openSession(session: SessionDto) {
        assertEdt()
        open(SessionRef.Local(session))
    }

    fun openSession(ref: SessionRef) {
        assertEdt()
        open(ref)
    }

    fun addListener(parent: Disposable, listener: SessionControllerListener) {
        if (disposed) return
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
        replay(listener)
    }

    internal fun snapshotState(): ControllerStateSnapshot {
        assertEdt()
        return ControllerStateSnapshot(
            showSession = model.showSession,
            viewState = viewState,
            connectionState = connectionState,
            connectionTargetState = connectionTargetState,
            refKey = ref?.key,
            refType = ref?.type?.name,
            sessionLoadState = sessionLoadState.toString(),
            recentsState = recentsState.toString(),
        )
    }

    internal fun flushEvents() {
        assertEdt()
        if (disposed) return
        updates.requestFlush(true)
    }

    fun enhancePrompt(text: String, complete: (Result<String>) -> Unit) {
        assertEdt()
        if (disposed) {
            complete(Result.failure(CancellationException("Session controller disposed")))
            return
        }
        val id = ++enhancement
        enhancements[id] = complete
        capture("Prompt Enhance Clicked", mapOf("textLength" to bucket(text)))
        cs.launch {
            val result = try {
                Result.success(sessions.enhancePrompt(directory, text))
            } catch (e: CancellationException) {
                Result.failure(e)
            } catch (e: Exception) {
                Result.failure(e)
            }
            edt {
                val callback = enhancements.remove(id) ?: return@edt
                result.onSuccess {
                    capture("Prompt Enhanced", mapOf("textLength" to bucket(text)))
                }.onFailure { e ->
                    if (e !is CancellationException) {
                        capture("Session Error", mapOf("context" to "enhance-prompt", "errorClass" to e::class.java.name))
                    }
                }
                callback(result)
            }
        }
    }

    fun prompt(text: String, files: List<PromptPartDto> = emptyList()) {
        assertEdt()
        val start = sid ?: ref?.key ?: "pending"
        val exists = sid != null
        val dto = promptDto(text, files)
        val props = promptProps(files)
        LOG.debug { "${ChatLogSummary.sid(start)} ${ChatLogSummary.prompt(dto)} ${ChatLogSummary.dir(directory)}" }
        dispatch(Dispatch("prompt", "user", text, props, start, exists)) { id ->
            sessions.prompt(id, directory, dto)
        }
    }

    fun command(command: String, args: String, files: List<PromptPartDto> = emptyList()) {
        assertEdt()
        val start = sid ?: ref?.key ?: "pending"
        val exists = sid != null
        val dto = promptDto("", files)
        val props = promptProps(files)
        LOG.debug { "${ChatLogSummary.sid(start)} kind=command command=$command args=${args.length} ${ChatLogSummary.dir(directory)}" }
        dispatch(Dispatch("command", "command", args, props, start, exists)) { id ->
            sessions.command(id, directory, command, args, dto)
        }
    }

    private fun dispatch(data: Dispatch, send: suspend (String) -> Unit) {
        assertEdt()
        if (revertOp != null) return
        val props = data.props + if (data.kind == "command") slashProps() else emptyMap()
        capture("Conversation Send Clicked", sessionProps(sid ?: ref?.key) + mapOf(
            "source" to data.source,
            "hasExistingSession" to data.exists.toString(),
            "textLength" to bucket(data.text),
        ) + props)
        showSession()
        val pending = sid?.let { CompletableDeferred(it) } ?: session()
        cs.launch {
            try {
                val id = pending.await() ?: return@launch
                send(id)
                capture("Conversation Message", sessionProps(id) + mapOf("source" to data.source, "hasExistingSession" to data.exists.toString()) + props)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=${data.kind} dispatched=true" }
            } catch (e: Exception) {
                capture("Session Error", sessionProps(sid ?: ref?.key ?: data.start) + mapOf("context" to data.kind, "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: data.start)} kind=${data.kind} dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    val msg = e.message ?: KiloBundle.message("session.error.prompt")
                    updateModel {
                        model.setState(SessionState.Error(msg))
                    }
                }
            }
        }
    }

    private fun session(): CompletableDeferred<String?> {
        assertEdt()
        val pending = creating
        if (pending != null) return pending
        val next = CompletableDeferred<String?>()
        creating = next
        cs.launch {
            try {
                next.complete(createSession())
            } catch (e: Exception) {
                next.completeExceptionally(e)
            } finally {
                edt {
                    if (creating === next) creating = null
                }
            }
        }
        return next
    }

    private suspend fun createSession(): String? {
        val session = sessions.create(directory)
        runEdt {
            if (disposed) return@runEdt
            ref = SessionRef.Local(session)
            setRecentSessionsState(RecentsState.Idle)
            updateModel {
                model.setSession(session)
            }
        }
        if (disposed) return null
        val meta = if (LOG.isDebugEnabled) ChatLogSummary.dir(directory) else "kind=session"
        LOG.info("${ChatLogSummary.sid(session.id)} kind=session $meta created=true")
        capture("Task Created", sessionProps(session.id) + mapOf("source" to "jetbrains"))
        runEdt {
            if (disposed) return@runEdt
            subscribeEvents()
        }
        return session.id
    }

    fun abort() {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=abort" }
        if (revertOp != null) {
            cancelRevert()
            return
        }
        val id = sid ?: return
        capture("Session Stop Clicked", sessionProps(id))
        cs.launch {
            try {
                sessions.abort(id, directory)
                capture("Session Stopped", sessionProps(id))
                LOG.debug { "${ChatLogSummary.sid(id)} kind=abort ok=true" }
            } catch (e: Exception) {
                capture("Session Error", sessionProps(id) + mapOf("context" to "abort", "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(id)} kind=abort dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    fun setAutoApprove(value: Boolean) {
        assertEdt()
        KiloPluginSettings.setAutoApprove(value)
        capture("Auto Approve Toggled", mapOf("enabled" to value.toString()))
        if (!value) {
            drainJob?.cancel()
            drainJob = null
            return
        }
        val current = model.state
        val skip = if (current is SessionState.AwaitingPermission) {
            approve(current.permission)
            setOf(current.permission.id)
        } else {
            emptySet()
        }
        drainAutoApprove(skip)
    }

    fun compact() {
        assertEdt()
        val id = sid ?: return
        if (revertOp != null || model.state.isBusy()) return
        if (model.isEmpty()) return
        val parsed = model.model?.let(::parseModel) ?: return
        val sel = ModelSelectionDto(parsed.first, parsed.second)
        LOG.debug { "${ChatLogSummary.sid(id)} kind=compact model=${sel.providerID}/${sel.modelID}" }
        cs.launch {
            try {
                sessions.compact(id, directory, sel)
                capture("Context Condensed", sessionProps(id) + mapOf("provider" to sel.providerID, "modelId" to sel.modelID))
                LOG.debug { "${ChatLogSummary.sid(id)} kind=compact ok=true" }
            } catch (e: Exception) {
                capture("Session Error", sessionProps(id) + mapOf("context" to "compact", "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(id)} kind=compact dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    updateModel {
                        model.setState(SessionState.Error(e.message ?: KiloBundle.message("session.error.compact")))
                    }
                }
            }
        }
    }

    fun revert(message: String, part: String? = null) {
        assertEdt()
        val id = sid
        if (id == null) {
            LOG.info(
                "${ChatLogSummary.sid(ref?.key ?: "pending")} kind=revert ignored=no-session " +
                    "message=$message part=${part ?: "none"}",
            )
            return
        }
        val state = model.state
        if (revertOp != null) return
        val busy = state.isBusy()
        LOG.info(
            "${ChatLogSummary.sid(id)} kind=revert clicked=true message=$message " +
                "part=${part ?: "none"} busy=$busy",
        )
        val op = beginReverting(
            KiloBundle.message("session.status.rollingback"),
            SessionState.Reverting.Kind.ROLLBACK,
            message,
        ) ?: return
        revertJob = cs.launch {
            try {
                if (busy) {
                    LOG.info("${ChatLogSummary.sid(id)} kind=revert abort=true reason=busy")
                    sessions.abort(id, directory)
                    LOG.info("${ChatLogSummary.sid(id)} kind=revert abort=true ok=true")
                }
                sessions.revert(id, directory, message, part)
                capture("Session Rollback", sessionProps(id))
                synchronizeFromDisk(id, "revert")
                LOG.info("${ChatLogSummary.sid(id)} kind=revert ok=true")
                edt { clearReverting(op) }
            } catch (e: CancellationException) {
                edt { cancelReverting(op) }
            } catch (e: Exception) {
                capture("Session Error", sessionProps(id) + mapOf("context" to "revert", "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(id)} kind=revert dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt { failReverting(op, e) }
            }
        }
    }

    fun unrevert() {
        assertEdt()
        val id = sid ?: return
        if (revertOp != null) return
        val op = beginReverting(
            KiloBundle.message("session.status.redoing"),
            SessionState.Reverting.Kind.REDO,
        ) ?: return
        revertJob = cs.launch {
            try {
                sessions.unrevert(id, directory)
                capture("Session Unrevert", sessionProps(id))
                synchronizeFromDisk(id, "unrevert")
                edt { clearReverting(op) }
            } catch (e: CancellationException) {
                edt { cancelReverting(op) }
            } catch (e: Exception) {
                capture("Session Error", sessionProps(id) + mapOf("context" to "unrevert", "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(id)} kind=unrevert dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt { failReverting(op, e) }
            }
        }
    }

    fun redo() {
        assertEdt()
        val mark = model.revert() ?: return
        val msgs = model.messages().toList()
        val pos = msgs.indexOfFirst { it.info.id == mark.messageID }
        if (pos < 0) {
            sid?.let { capture("Session Redo", sessionProps(it)) }
            unrevert()
            return
        }
        val next = msgs.drop(pos + 1).firstOrNull { it.info.role == "user" }
        if (next == null) {
            sid?.let { capture("Session Redo", sessionProps(it)) }
            unrevert()
            return
        }
        sid?.let { capture("Session Redo", sessionProps(it)) }
        redoTo(next.info.id)
    }

    private fun redoTo(message: String) {
        assertEdt()
        val id = sid ?: return
        val state = model.state
        if (revertOp != null) return
        val busy = state.isBusy()
        val op = beginReverting(
            KiloBundle.message("session.status.redoing"),
            SessionState.Reverting.Kind.REDO,
            message,
        ) ?: return
        revertJob = cs.launch {
            try {
                if (busy) {
                    LOG.info("${ChatLogSummary.sid(id)} kind=redo abort=true reason=busy")
                    sessions.abort(id, directory)
                    LOG.info("${ChatLogSummary.sid(id)} kind=redo abort=true ok=true")
                }
                sessions.revert(id, directory, message, null)
                synchronizeFromDisk(id, "redo")
                edt { clearReverting(op) }
            } catch (e: CancellationException) {
                edt { cancelReverting(op) }
            } catch (e: Exception) {
                edt { failReverting(op, e) }
            }
        }
    }

    fun redoAll() {
        assertEdt()
        sid?.let { capture("Session Redo All", sessionProps(it)) }
        unrevert()
    }

    fun cancelRevert() {
        assertEdt()
        if (revertOp == null) return
        LOG.info("${ChatLogSummary.sid(sid ?: "?")} kind=revert cancelRequested=true")
        sid?.let { capture("Session Revert Cancel Requested", sessionProps(it)) }
        val state = model.state
        if (state is SessionState.Reverting) {
            model.setState(state.copy(text = KiloBundle.message("session.status.operation.finishing")))
        }
        revertJob?.cancel()
    }

    private fun synchronizeFromDisk(id: String, kind: String) {
        ApplicationManager.getApplication().invokeLater {
            runCatching {
                val action = ActionManager.getInstance().getAction(IdeActions.ACTION_SYNCHRONIZE)
                if (action == null) {
                    LOG.info("${ChatLogSummary.sid(id)} kind=$kind sync=synchronize skipped=no-action")
                    return@invokeLater
                }
                ActionManager.getInstance().tryToExecute(action, null, comp, ActionPlaces.UNKNOWN, true)
                LOG.info("${ChatLogSummary.sid(id)} kind=$kind sync=synchronize ok=true")
            }.onFailure { err ->
                LOG.warn("${ChatLogSummary.sid(id)} kind=$kind sync=synchronize failed message=${err.message}", err)
            }
        }
    }

    fun retryConnection() {
        assertEdt()
        LOG.debug {
            "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=connection-retry app=${model.app.status} workspace=${model.workspace.status}"
        }
        capture("Connection Retry Clicked", connectionProps())
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
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=config agent=$name" }
        agentTime = null
        modelTime = null
        prefModel = null
        prefAgent = null
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(agent = name))
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=config agent=$name dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
        fire(SessionControllerEvent.WorkspaceReady) {
            model.agent = name
            syncModelSelection()
        }
        capture("Mode Switched", sessionProps() + mapOf("agent" to name))
    }

    fun selectModel(provider: String, id: String) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=config model=$provider/$id" }
        val agent = model.agent ?: return
        val key = "$provider/$id"
        if (item(key) == null && model.workspace.providers != null) return
        modelTime = null
        prefModel = null
        prefAgent = null
        app.selectModel(agent, provider, id)
        selectResolvedModel(key)
        model.modelOverride = model.defaultModel != model.model
        capture("Model Selected", sessionProps() + mapOf("agent" to agent, "provider" to provider, "modelId" to id, "isOverride" to "true"))
    }

    fun clearModelOverride() {
        assertEdt()
        val agent = model.agent ?: return
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=config model-reset agent=$agent" }
        app.clearModel(agent)
        val auto = configModel(agent) ?: providerModel(agent)
        selectResolvedModel(auto)
        model.modelOverride = false
        capture("Model Override Cleared", sessionProps() + mapOf("agent" to agent))
    }

    fun selectVariant(value: String) {
        assertEdt()
        val key = model.model ?: return
        if (value !in model.variants) return
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=config variant=$key/$value" }
        app.selectVariant(key, value)
        model.variant = value
        capture("Reasoning Variant Selected", sessionProps() + mapOf("model" to key, "variant" to value))
    }

    // ------ permission / question resolution ------

    fun replyPermission(requestId: String, reply: PermissionReplyDto, rules: PermissionAlwaysRulesDto? = null) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission rid=$requestId reply=${reply.reply}" }
        val current = model.state as? SessionState.AwaitingPermission
        updatePermission(requestId, PermissionRequestState.RESPONDING)
        cs.launch {
            try {
                if (rules != null) sessions.savePermissionRules(requestId, directory, rules)
                if (rules != null) workspace.refreshConfigFiles()
                sessions.replyPermission(requestId, directory, reply)
                capture("Approval Answered", sessionProps() + mapOf(
                    "requestId" to requestId,
                    "tool" to (current?.permission?.name ?: "unknown"),
                    "reply" to reply.reply,
                    "hasRules" to (rules != null).toString(),
                    "hasDiffs" to (current?.permission?.meta?.fileDiffs?.isNotEmpty() == true).toString(),
                    "diffCount" to (current?.permission?.meta?.fileDiffs?.size ?: 0).toString(),
                ))
                LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission rid=$requestId ok=true" }
            } catch (e: Exception) {
                capture("Session Error", sessionProps() + mapOf("context" to "permission", "errorClass" to e::class.java.name))
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission rid=$requestId reply=${reply.reply} dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    updatePermission(
                        requestId,
                        PermissionRequestState.ERROR,
                        e.message ?: KiloBundle.message("session.permission.error"),
                    )
                }
            }
        }
    }

    private fun approve(request: PermissionRequestDto) {
        approve(request.id) { toPermission(request) }
    }

    private fun approve(permission: Permission) {
        approve(permission.id) { permission }
    }

    private fun approve(id: String, restore: () -> Permission) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission-auto rid=$id" }
        cs.launch {
            try {
                if (!autoApprove) {
                    edt {
                        if (disposed) return@edt
                        model.setState(SessionState.AwaitingPermission(restore()))
                    }
                    return@launch
                }
                edt {
                    if (disposed) return@edt
                    model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
                }
                sessions.replyPermission(id, directory, PermissionReplyDto("once"))
                capture("Permission Auto Approved", sessionProps() + mapOf("tool" to restore().name, "source" to "single"))
                LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission-auto rid=$id ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=permission-auto rid=$id dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    model.setState(SessionState.AwaitingPermission(restore().copy(
                        state = PermissionRequestState.ERROR,
                        message = e.message ?: KiloBundle.message("session.permission.error"),
                    )))
                }
            }
        }
    }

    @RequiresEdt
    private fun drainAutoApprove(skip: Set<String> = emptySet()) {
        assertEdt()
        val id = sid ?: return
        val ids = (childIds + id).toSet()
        drainJob?.cancel()
        drainJob = cs.launch {
            try {
                val permissions = sessions.pendingPermissions(directory).filter { it.sessionID in ids && it.id !in skip }
                val count = replyAll(permissions)
                if (count == 0) return@launch
                runEdt {
                    if (disposed) return@runEdt
                    val current = model.state
                    if (current is SessionState.AwaitingPermission && current.permission.sessionId in ids) {
                        model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
                    }
                }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=permission-auto-drain dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    private suspend fun replyAll(permissions: List<PermissionRequestDto>): Int {
        var count = 0
        for (request in permissions) {
            if (!autoApprove) return count
            sessions.replyPermission(request.id, directory, PermissionReplyDto("once"))
            capture("Permission Auto Approved", sessionProps(request.sessionID) + mapOf("tool" to request.permission, "source" to "drain"))
            count++
        }
        return count
    }

    private fun updatePermission(id: String, state: PermissionRequestState, message: String? = null) {
        assertEdt()
        val current = model.state
        if (current !is SessionState.AwaitingPermission) return
        if (current.permission.id != id) return
        val perm = current.permission.copy(
            state = state,
            message = message ?: current.permission.message,
        )
        updateModel { model.setState(SessionState.AwaitingPermission(perm)) }
    }

    fun replyQuestion(requestId: String, answers: QuestionReplyDto, options: List<List<String>> = answers.answers) {
        assertEdt()
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId answers=${answers.answers.size}" }
        val current = model.state
        followup = if (current is SessionState.AwaitingQuestion
            && current.question.id == requestId
            && options.any { labels -> labels.any { it.trim() == FOLLOWUP_NEW_SESSION } }
        ) {
            Followup(directory, System.currentTimeMillis())
        } else null
        val follow = followup != null
        cs.launch {
            try {
                sessions.replyQuestion(requestId, directory, answers)
                capture("Question Answered", sessionProps() + mapOf(
                    "requestId" to requestId,
                    "answerCount" to answers.answers.size.toString(),
                    "hasFollowupNewSession" to follow.toString(),
                ))
                LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId ok=true" }
            } catch (e: Exception) {
                edt { followup = null }
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId answers=${answers.answers.size} dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    fun rejectQuestion(requestId: String) {
        assertEdt()
        followup = null
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId rejected=true" }
        cs.launch {
            try {
                sessions.rejectQuestion(requestId, directory)
                capture("Question Rejected", sessionProps() + mapOf("requestId" to requestId))
                LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId ok=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} kind=question rid=$requestId rejected=true dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
            }
        }
    }

    init {
        (ref as? SessionRef.Local)?.session?.let { model.setSession(it) }
        when (val item = ref) {
            is SessionRef.Cloud -> {
                val token = SessionLoadState.Loading()
                startSessionLoading(token)
                importCloud(item.id, token)
            }
            is SessionRef.Local -> {
                val token = SessionLoadState.Loading()
                startSessionLoading(token)
                loadSession(token)
                subscribeEvents()
            }
            null -> Unit
        }

        model.addListener(this) { event ->
            LOG.debug { "session=${sid ?: ref?.key ?: "pending"} model: $event" }
        }

        app.connect()
        cs.launch {
            app.state.collect { state ->
                if (state.status == KiloAppStatusDto.READY) app.fetchVersionAsync()
                fire(SessionControllerEvent.AppChanged) {
                    model.app = state
                    model.version = app.version
                    if (model.state is SessionState.LoginRequired && state.profile != null) {
                        resumeAfterLogin()
                    }
                    syncModelSelection()
                    syncConnectionState()
                    refreshAccountOverlay()
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
                                        id = id,
                                        display = info.name,
                                        provider = provider.id,
                                        providerName = provider.name,
                                        inputPrice = info.inputPrice,
                                        outputPrice = info.outputPrice,
                                        contextLength = info.contextLength,
                                        releaseDate = info.releaseDate,
                                        latest = info.latest,
                                        recommendedIndex = info.recommendedIndex,
                                        free = info.free,
                                        byok = info.byok,
                                        variants = info.variants,
                                        limit = info.limit?.let { ModelLimitItem(it.context, it.input, it.output) },
                                        cost = info.cost,
                                        capabilities = info.capabilities,
                                        options = info.options,
                                        autoRouting = info.autoRouting,
                                        terminalBench = info.terminalBench,
                                        reasoning = info.reasoning,
                                        attachment = info.attachment,
                                        mayTrainOnYourPrompts = info.mayTrainOnYourPrompts,
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
                        if (canUseRecents()) refreshRecents()
                    }
                }
            }
        }
    }

    private fun loadSession(token: SessionLoadState.Loading) {
        val target = ref as? SessionRef.Local ?: return
        val id = target.id
        cs.launch {
            try {
                val session = target.session ?: runCatching { sessions.get(id, directory) }.getOrNull()
                val items = sessions.messages(id, directory)
                LOG.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(items)}" }
                val discovered = children(items)
                runEdt {
                    if (disposed) return@runEdt
                    if (sid != id) return@runEdt
                    updateModel {
                        snapshots.clear()
                        childParts.clear()
                        childParts.putAll(discovered)
                        this@SessionController.model.loadHistory(items)
                        syncHistoryAgent(items)
                        if (session != null) this@SessionController.model.setSession(session)
                    }
                }
                recoverPending(id)
                runEdt {
                    if (disposed) return@runEdt
                    if (sid != id) return@runEdt
                    for (child in discovered.values.toSet()) trackChild(child)
                    showSession()
                    loaded(!model.isEmpty())
                }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=history dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    if (sid != id) return@edt
                    updateModel {
                        model.setState(SessionState.Error(e.message ?: KiloBundle.message("history.error.local")))
                    }
                    showSession()
                    loaded(false)
                }
            } finally {
                edt {
                    if (disposed) return@edt
                    if (sessionLoadState != token) return@edt
                    setSessionLoadState(SessionLoadState.Idle)
                }
                updates.holdFlush(false)
                updates.requestFlush(true)
            }
        }
    }

    private fun importCloud(id: String, token: SessionLoadState.Loading) {
        cs.launch {
            try {
                val session = sessions.importCloudSession(id, directory)
                val items = sessions.messages(session.id, directory)
                LOG.debug { "${ChatLogSummary.sid(session.id)} ${ChatLogSummary.history(items)}" }
                val discovered = children(items)
                runEdt {
                    if (disposed) return@runEdt
                    ref = SessionRef.Local(session)
                    setRecentSessionsState(RecentsState.Idle)
                    updateModel {
                        snapshots.clear()
                        this@SessionController.model.loadHistory(items)
                        syncHistoryAgent(items)
                        this@SessionController.model.setSession(session)
                    }
                }
                recoverPending(session.id)
                runEdt {
                    if (disposed) return@runEdt
                    subscribeEvents()
                    childParts.clear()
                    childParts.putAll(discovered)
                    for (child in discovered.values.toSet()) trackChild(child)
                    showSession()
                    loaded(!model.isEmpty())
                }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=cloud-import dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    updateModel {
                        model.setState(SessionState.Error(e.message ?: KiloBundle.message("history.error.cloud")))
                    }
                    showSession()
                    loaded(false)
                }
            } finally {
                edt {
                    if (disposed) return@edt
                    if (sessionLoadState != token) return@edt
                    setSessionLoadState(SessionLoadState.Idle)
                }
                updates.holdFlush(false)
                updates.requestFlush(true)
            }
        }
    }

    private fun startSessionLoading(token: SessionLoadState.Loading) {
        assertEdt()
        setSessionLoadState(token)
        model.setState(SessionState.Loading)
        if (!model.showSession) setControllerViewState(SessionControllerEvent.ViewChanged.ShowProgress)
    }

    @RequiresEdt
    private fun subscribeEvents() {
        assertEdt()
        val id = sid ?: return
        LOG.debug { "${ChatLogSummary.sid(id)} kind=subscription subscribe=true" }
        cancelSubscriptions()
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
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(id)} kind=subscription route=controller-events failed message=${e.message}", e)
            } finally {
                LOG.debug { "${ChatLogSummary.sid(id)} kind=subscription subscribe=false" }
            }
        }
    }

    @RequiresEdt
    private fun subscribeChild(child: String) {
        assertEdt()
        if (childJobs.containsKey(child)) return
        LOG.debug { "${ChatLogSummary.sid(sid ?: "pending")} kind=child-subscription child=$child subscribe=true" }
        val job = cs.launch {
            try {
                sessions.events(child, directory).collect { event ->
                    if (!isChildEvent(event, child)) return@collect
                    LOG.debug { "${ChatLogSummary.sid(sid ?: "pending")} kind=child-event child=$child ${ChatLogSummary.eventBody(event)}" }
                    updates.enqueue(event)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(sid ?: "pending")} kind=child-subscription child=$child failed message=${e.message}", e)
            } finally {
                LOG.debug { "${ChatLogSummary.sid(sid ?: "pending")} kind=child-subscription child=$child subscribe=false" }
            }
        }
        childJobs[child] = job
    }

    @RequiresEdt
    private fun trackChild(child: String) {
        assertEdt()
        if (!childIds.add(child)) return
        subscribeChild(child)
        cs.launch { seedChild(child) }
        cs.launch { recoverChildPermissions(child) }
    }

    @RequiresEdt
    private fun trackChild(key: PartKey, child: String) {
        assertEdt()
        childParts[key] = child
        trackChild(child)
    }

    @RequiresEdt
    private fun untrackChild(key: PartKey) {
        assertEdt()
        val child = childParts.remove(key) ?: return
        if (child in childParts.values) return
        childIds.remove(child)
        childJobs.remove(child)?.cancel()
    }

    @RequiresEdt
    private fun untrackChildren(messageId: String) {
        assertEdt()
        childParts.keys.filter { it.messageId == messageId }.forEach(::untrackChild)
    }

    @RequiresEdt
    private fun cancelSubscriptions() {
        assertEdt()
        eventJob?.cancel()
        eventJob = null
        childJobs.values.forEach { it.cancel() }
        childJobs.clear()
        childIds.clear()
        childParts.clear()
    }

    private suspend fun recoverChildPermissions(child: String) {
        try {
            val permissions = sessions.pendingPermissions(directory).filter { it.sessionID == child }
            if (permissions.isEmpty()) return
            LOG.debug { "${ChatLogSummary.sid(sid ?: "pending")} kind=child-recovery child=$child permissions=${permissions.size}" }
            if (autoApprove) {
                replyAll(permissions)
                return
            }
            val last = toPermission(permissions.last())
            runEdt {
                if (disposed) return@runEdt
                if (child !in childIds) return@runEdt
                // Do not overwrite an existing root or other child AwaitingPermission state
                if (model.state is SessionState.AwaitingPermission) return@runEdt
                updateModel { model.setState(SessionState.AwaitingPermission(last)) }
            }
        } catch (e: Exception) {
            LOG.warn("${ChatLogSummary.sid(sid ?: "pending")} kind=child-recovery child=$child dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
        }
    }

    private suspend fun seedChild(child: String) {
        try {
            val items = sessions.messages(child, directory)
            runEdt {
                if (disposed) return@runEdt
                if (child !in childIds) return@runEdt
                updateModel {
                    for (msg in items) {
                        if (msg.info.role != "assistant") continue
                        for (part in msg.parts) {
                            if (part.type == "tool") model.upsertChildTool(child, part, replace = false)
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LOG.warn("${ChatLogSummary.sid(sid ?: "pending")} kind=child-history child=$child dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
        }
    }

    /** Rehydrate pending permissions/questions and current session status after history load. */
    private suspend fun recoverPending(id: String) {
        try {
            val permissions = sessions.pendingPermissions(directory).filter { it.sessionID == id }
            val questions = sessions.pendingQuestions(directory).filter { it.sessionID == id }
            val status = sessions.statuses.value[id]
            if (permissions.isNotEmpty() && autoApprove) {
                val count = replyAll(permissions)
                if (count > 0) {
                    runEdt {
                        if (disposed) return@runEdt
                        if (sid != id) return@runEdt
                        model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
                    }
                    return
                }
            }
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
                if (disposed) return@runEdt
                if (sid != id) return@runEdt
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
        LOG.debug { "${ChatLogSummary.sid(sid ?: ref?.key ?: "pending")} evt=session.status ${ChatLogSummary.status(dto)}" }
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
                syncMessagePrefs(event.info)
                if (added) showSession()
            }

            is ChatEventDto.PartUpdated -> {
                if (childIds.contains(event.sessionID)) {
                    if (event.part.type == "tool") model.upsertChildTool(event.sessionID, event.part)
                    return
                }
                partType = event.part.type
                tool = event.part.tool
                val key = PartKey(event.part.messageID, event.part.id)
                val prev = content(event.part.messageID, event.part.id)
                val child = childID(event.part)
                val old = childParts[key]
                if (old != null && old != child) untrackChild(key)
                model.updateContent(event.part.messageID, event.part)
                val next = content(event.part.messageID, event.part.id)
                if (next != null && next != prev) {
                    snapshots[key] = next
                } else {
                    snapshots.remove(key)
                }
                val s = model.state
                if (s is SessionState.Busy || s is SessionState.Retry || s is SessionState.Offline) {
                    model.setState(SessionState.Busy(status()))
                }
                if (child != null) trackChild(key, child)
            }

            is ChatEventDto.PartDelta -> {
                if (event.field == "text") {
                    val delta = glue(event.messageID, event.partID, event.delta)
                    if (delta.isNotEmpty()) model.appendDelta(event.messageID, event.partID, delta)
                }
            }

            is ChatEventDto.PartRemoved -> {
                if (childIds.contains(event.sessionID)) {
                    model.removeChildTool(event.sessionID, event.partID)
                    return
                }
                val key = PartKey(event.messageID, event.partID)
                snapshots.remove(key)
                untrackChild(key)
                model.removeContent(event.messageID, event.partID)
            }

            is ChatEventDto.TurnOpen -> {
                partType = null
                tool = null
                if (revertOp != null) {
                    revertDeferred = SessionState.Busy(KiloBundle.message("session.status.considering"))
                    return
                }
                model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
            }

            is ChatEventDto.TurnClose -> {
                partType = null
                tool = null
                if (revertOp != null) {
                    revertDeferred = SessionState.Idle
                    return
                }
                // Keep pending questions visible for follow-up flows that arrive just before close.
                val current = model.state
                if (current is SessionState.AwaitingQuestion) return
                val clobberOk = event.reason == "completed"
                    || current is SessionState.Busy
                    || current is SessionState.Retry
                    || current is SessionState.Offline
                if (clobberOk) {
                    if (event.reason == "completed") capture("Task Completed", sessionProps(event.sessionID))
                    model.setState(SessionState.Idle)
                }
            }

            is ChatEventDto.SessionCreated -> adoptFollowup(event.info)

            is ChatEventDto.Error -> {
                capture("Session Error", sessionProps(event.sessionID) + mapOf("context" to "event", "errorClass" to (event.error?.type ?: "unknown")))
                error(event, true)
            }

            is ChatEventDto.MessageRemoved -> {
                snapshots.keys.removeAll { it.messageId == event.messageID }
                untrackChildren(event.messageID)
                model.removeMessage(event.messageID)
            }

            is ChatEventDto.PermissionAsked -> {
                asked(event)
            }

            is ChatEventDto.PermissionReplied -> {
                replied(event)
            }

            is ChatEventDto.QuestionAsked -> {
                asked(event)
            }

            is ChatEventDto.QuestionReplied -> {
                replied(event)
            }

            is ChatEventDto.QuestionRejected -> {
                rejected(event)
            }

            is ChatEventDto.SessionStatusChanged -> {
                status(event.status)
            }

            is ChatEventDto.SessionUpdated -> model.setSession(event.session)

            is ChatEventDto.SessionIdle -> {
                idle()
            }

            is ChatEventDto.SessionCompacted -> {
                capture("Context Condensed", sessionProps(event.sessionID))
                model.markCompacted()
            }
            is ChatEventDto.SessionDiffChanged -> model.setDiff(event.diff)
            is ChatEventDto.TodoUpdated -> model.setTodos(event.todos)
        }
    }

    private fun glue(messageId: String, partId: String, delta: String): String {
        if (delta.isEmpty()) return delta
        val key = PartKey(messageId, partId)
        val cur = snapshots[key] ?: return delta
        val span = (minOf(cur.length, delta.length) downTo 1)
            .firstOrNull { n -> cur.regionMatches(cur.length - n, delta, 0, n) } ?: 0
        if (span == delta.length) {
            snapshots.remove(key)
            return ""
        }
        snapshots.remove(key)
        return delta.substring(span)
    }

    private fun content(messageId: String, partId: String): String? = when (val content = model.content(messageId, partId)) {
        is Text -> content.content.toString()
        is Reasoning -> content.content.toString()
        else -> null
    }

    private fun handleHidden(event: ChatEventDto): Boolean = when (event) {
        is ChatEventDto.Error,
        is ChatEventDto.PermissionAsked,
        is ChatEventDto.PermissionReplied,
        is ChatEventDto.QuestionAsked,
        is ChatEventDto.QuestionReplied,
        is ChatEventDto.QuestionRejected,
        is ChatEventDto.SessionStatusChanged,
        is ChatEventDto.SessionUpdated,
        is ChatEventDto.SessionIdle -> {
            edt {
                if (disposed) return@edt
                updateModel { handleMetadata(event) }
            }
            true
        }
        else -> false
    }

    private fun handleMetadata(event: ChatEventDto) {
        LOG.debug { ChatLogSummary.event(event) }
        when (event) {
            is ChatEventDto.Error -> error(event, false)
            is ChatEventDto.PermissionAsked -> asked(event)
            is ChatEventDto.PermissionReplied -> replied(event)
            is ChatEventDto.QuestionAsked -> asked(event)
            is ChatEventDto.QuestionReplied -> replied(event)
            is ChatEventDto.QuestionRejected -> rejected(event)
            is ChatEventDto.SessionStatusChanged -> status(event.status)
            is ChatEventDto.SessionUpdated -> model.setSession(event.session)
            is ChatEventDto.SessionIdle -> idle()
            else -> Unit
        }
    }

    private fun error(event: ChatEventDto.Error, reveal: Boolean) {
        partType = null
        tool = null
        if (isPaidModelAuthRequired(event.error)) {
            loginRetry = retryPrompt()
            if (reveal) showSession()
            capture("Account Overlay Shown", sessionProps(event.sessionID) + mapOf(
                "surface" to "session",
                "reason" to "paid_model_auth",
            ))
            model.setState(SessionState.LoginRequired(KiloBundle.message("session.login.required.description")))
            return
        }
        val msg = event.error?.message ?: event.error?.type ?: KiloBundle.message("session.error.unknown")
        model.setState(SessionState.Error(msg, event.error?.type))
    }

    private fun asked(event: ChatEventDto.PermissionAsked) {
        if (autoApprove) {
            approve(event.request)
            return
        }
        val perm = toPermission(event.request)
        model.setState(SessionState.AwaitingPermission(perm))
    }

    private fun replied(event: ChatEventDto.PermissionReplied) {
        val current = model.state
        if (current is SessionState.AwaitingPermission && current.permission.id == event.requestID) {
            model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
        }
    }

    private fun asked(event: ChatEventDto.QuestionAsked) {
        model.setState(SessionState.AwaitingQuestion(toQuestion(event.request)))
    }

    private fun replied(event: ChatEventDto.QuestionReplied) {
        val current = model.state
        if (current is SessionState.AwaitingQuestion && current.question.id == event.requestID) {
            model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
        }
    }

    private fun rejected(event: ChatEventDto.QuestionRejected) {
        val current = model.state
        if (current is SessionState.AwaitingQuestion && current.question.id == event.requestID) {
            model.setState(SessionState.Idle)
        }
    }

    private fun status(dto: SessionStatusDto) {
        if (revertOp != null) {
            revertDeferred = when (dto.type) {
                "idle" -> SessionState.Idle
                "busy" -> SessionState.Busy(KiloBundle.message("session.status.considering"))
                "retry" -> SessionState.Retry(dto.message ?: "", dto.attempt ?: 0, dto.next ?: 0L)
                "offline" -> SessionState.Offline(dto.message ?: "", dto.requestID ?: "")
                else -> revertDeferred
            }
            return
        }
        val state = when (dto.type) {
            "idle" -> {
                val current = model.state
                if (current is SessionState.LoginRequired || current is SessionState.Reverting) return
                SessionState.Idle
            }
            "busy" -> {
                val current = model.state
                if (current is SessionState.Idle || current is SessionState.Error)
                    SessionState.Busy(KiloBundle.message("session.status.considering"))
                else return // already in a more specific phase
            }
            "retry" -> SessionState.Retry(
                message = dto.message ?: "",
                attempt = dto.attempt ?: 0,
                next = dto.next ?: 0L,
            )
            "offline" -> SessionState.Offline(
                message = dto.message ?: "",
                requestId = dto.requestID ?: "",
            )
            else -> return
        }
        model.setState(state)
    }

    private fun beginReverting(text: String, kind: SessionState.Reverting.Kind, message: String? = null): RevertOp? {
        assertEdt()
        if (revertOp != null) return null
        val op = RevertOp(++revertSeq)
        revertOp = op
        // Start with no deferred state; only turn/status transitions that actually arrive while the
        // revert is held are recorded, so an aborted turn releases to Idle and a still-active turn
        // (e.g. one that opened after the busy check) releases back to Busy.
        revertDeferred = null
        model.setState(SessionState.Reverting(text, kind, message))
        startRevertWatchdog(op)
        return op
    }

    private fun startRevertWatchdog(op: RevertOp) {
        assertEdt()
        stopRevertWatchdog()
        val ms = revertTimeoutMs.coerceIn(1, Int.MAX_VALUE.toLong()).toInt()
        revertWatchdog = timers.timer(ms, repeats = false) { onRevertTimeout(op) }.also { it.start() }
    }

    private fun stopRevertWatchdog() {
        revertWatchdog?.stop()
        revertWatchdog = null
    }

    private fun onRevertTimeout(op: RevertOp) {
        assertEdt()
        if (revertOp?.key != op.key) return
        LOG.warn("${ChatLogSummary.sid(sid ?: "?")} kind=revert timeout=true after=${revertTimeoutMs}ms")
        stopRevertWatchdog()
        sid?.let { capture("Session Revert Timeout", sessionProps(it)) }
        revertJob?.cancel()
        failReverting(op, RuntimeException(KiloBundle.message("session.error.revert.timeout")))
    }

    private fun clearReverting(op: RevertOp) {
        assertEdt()
        if (revertOp?.key != op.key) return
        stopRevertWatchdog()
        revertJob = null
        revertOp = null
        reconcileReverting()
    }

    private fun cancelReverting(op: RevertOp) {
        assertEdt()
        if (revertOp?.key != op.key) return
        stopRevertWatchdog()
        revertJob = null
        revertOp = null
        reconcileReverting()
    }

    // Release the revert lock back to whatever turn/status transition arrived while it was held,
    // so an underlying server turn is restored instead of leaving an idle prompt over an active turn.
    private fun reconcileReverting() {
        assertEdt()
        val next = revertDeferred ?: SessionState.Idle
        revertDeferred = null
        if (model.state is SessionState.Reverting) model.setState(next)
    }

    private fun failReverting(op: RevertOp, e: Exception) {
        assertEdt()
        if (revertOp?.key != op.key) return
        stopRevertWatchdog()
        revertJob = null
        revertOp = null
        // A failed revert surfaces the error explicitly; drop any deferred turn state.
        revertDeferred = null
        model.setState(SessionState.Error(e.message ?: KiloBundle.message("session.error.unknown")))
    }

    private fun idle() {
        if (revertOp != null) {
            revertDeferred = SessionState.Idle
            return
        }
        // Treat session.idle as an explicit signal to return to Idle.
        // Only apply if we're not in a more specific non-terminal state.
        val current = model.state
        if (current !is SessionState.Error
            && current !is SessionState.AwaitingPermission
            && current !is SessionState.AwaitingQuestion
            && current !is SessionState.LoginRequired
            && current !is SessionState.Reverting
        ) {
            model.setState(SessionState.Idle)
        }
    }

    private fun retryPrompt(): PromptDto? {
        val msg = model.messages().lastOrNull { it.info.role == "user" } ?: return null
        return PromptDto(
            parts = emptyList(),
            messageID = msg.info.id,
            providerID = msg.info.providerID,
            modelID = msg.info.modelID,
            agent = msg.info.agent,
            variant = model.variant?.takeIf { it in model.variants },
            noReply = false,
        )
    }

    private fun resumeAfterLogin() {
        assertEdt()
        val retry = loginRetry
        loginRetry = null
        if (retry == null) {
            model.setState(SessionState.Idle)
            return
        }
        val id = sid
        if (id == null) {
            model.setState(SessionState.Idle)
            return
        }
        model.setState(SessionState.Busy(KiloBundle.message("session.status.considering")))
        cs.launch {
            try {
                sessions.prompt(id, directory, retry)
                LOG.debug { "${ChatLogSummary.sid(id)} kind=login-resume dispatched=true" }
            } catch (e: Exception) {
                LOG.warn("${ChatLogSummary.sid(id)} kind=login-resume dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    val msg = e.message ?: KiloBundle.message("session.error.prompt")
                    model.setState(SessionState.Error(msg))
                }
            }
        }
    }

    private fun promptDto(text: String, files: List<PromptPartDto> = emptyList()): PromptDto {
        val full = model.model
        val sel = full?.let(::parseModel)
        val variant = model.variant?.takeIf { it in model.variants }
        val parts = buildList {
            text.takeIf { it.isNotBlank() }?.let { add(PromptPartDto(type = "text", text = it)) }
            addAll(files)
        }
        return PromptDto(
            parts = parts,
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
        model.modelOverride = messageSelection(agent) == null && selected != auto
    }

    private fun selectedModel(agent: String, auto: String?): String? {
        messageSelection(agent)?.let { return it.key }
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

    private fun messageSelection(agent: String): ModelSelectionDto? {
        if (prefAgent != null && prefAgent != agent) return null
        return valid(model.workspace.providers, prefModel?.let(::selection))
    }

    private fun handle(events: List<ChatEventDto>) {
        updateModel {
            for (event in events) handle(event)
        }
    }

    private fun adoptFollowup(session: SessionDto) {
        assertEdt()
        val item = followup ?: return
        if (System.currentTimeMillis() - item.time > FOLLOWUP_TTL_MS) {
            followup = null
            return
        }
        if (pathKey(item.dir) != pathKey(session.directory)) return
        followup = null
        open(SessionRef.Local(session))
    }

    private fun syncHistoryAgent(items: List<MessageWithPartsDto>) {
        val before = model.prefs()
        val agent = items
            .map { it.info }
            .filter { messageAgent(it) != null }
            .maxByOrNull { it.time.created }
        val msg = items
            .map { it.info }
            .filter { it.role == "user" && messageModel(it) != null }
            .maxByOrNull { it.time.created }
        agentTime = agent?.time?.created
        modelTime = msg?.time?.created
        messageAgent(agent)?.let { model.agent = it }
        prefModel = messageModel(msg)
        prefAgent = messageAgent(msg) ?: model.agent
        syncModelSelection()
        if (model.prefs() != before) fire(SessionControllerEvent.WorkspaceReady)
    }

    private fun syncMessagePrefs(info: MessageDto) {
        val before = model.prefs()
        val agent = messageAgent(info)
        val prior = agentTime
        if (agent != null && (info.time.created >= (prior ?: Double.NEGATIVE_INFINITY))) {
            agentTime = info.time.created
            model.agent = agent
        }
        val key = messageModel(info)
        val last = modelTime
        if (info.role == "user" && key != null && (info.time.created >= (last ?: Double.NEGATIVE_INFINITY))) {
            modelTime = info.time.created
            prefModel = key
            prefAgent = agent ?: model.agent
        }
        syncModelSelection()
        if (model.prefs() != before) fire(SessionControllerEvent.WorkspaceReady)
    }

    private fun messageAgent(info: MessageDto?): String? {
        val agent = info?.agent?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (model.agents.isNotEmpty() && model.agents.none { it.name == agent }) return null
        return agent
    }

    private fun messageModel(info: MessageDto?): String? {
        val msg = info ?: return null
        val provider = msg.providerID?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val id = msg.modelID?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val key = "$provider/$id"
        if (item(key) == null && model.workspace.providers != null) return null
        return key
    }

    private fun SessionModel.prefs(): Pref = Pref(agent, model, variants, variant, modelOverride)

    private fun updateModel(block: () -> Unit) {
        assertEdt()
        if (disposed) return
        val follow = beforeUpdate()
        block()
        afterUpdate(follow)
    }

    private fun showSession() {
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

    fun selectOrganization(org: String?) {
        assertEdt()
        val next = OrganizationTarget(org)
        if (target == next) return
        target = next
        refreshAccountOverlay()
        cs.launch {
            try {
                app.setOrganization(org)
                capture("Organization Switched", mapOf("target" to if (org == null) "personal" else "organization"))
            } catch (e: Exception) {
                capture("Account Connect Failed", mapOf("stage" to "organization", "errorClass" to e::class.java.name))
                LOG.warn("account switch failed org=$org message=${e.message}", e)
                edt {
                    if (disposed) return@edt
                    target = null
                    refreshAccountOverlay()
                }
            }
        }
    }

    fun openProfile() {
        assertEdt()
        capture("Profile Settings Opened", mapOf("surface" to "session_overlay"))
        openProfileAction()
    }

    private fun capture(event: String, props: Map<String, String> = emptyMap()) {
        telemetry(event, props)
    }

    private fun sessionProps(id: String? = sid): Map<String, String> = buildMap {
        id?.let { put("sessionId", it) }
        if (ApplicationManager.getApplication().isDispatchThread) {
            model.agent?.let { put("agent", it) }
            model.model?.let { put("model", it) }
        }
    }

    private fun promptProps(files: List<PromptPartDto> = emptyList()): Map<String, String> = buildMap {
        model.agent?.let { put("agent", it) }
        model.model?.let { key ->
            put("model", key)
            parseModel(key)?.let { sel ->
                put("provider", sel.first)
                put("modelId", sel.second)
            }
        }
        model.variant?.takeIf { it in model.variants }?.let { put("variant", it) }
        if (files.isNotEmpty()) {
            put("attachmentCount", files.size.toString())
            put("mediaAttachmentCount", files.count { it.mime?.startsWith("image/") == true || it.mime == "application/pdf" }.toString())
        }
        val mentions = files.filter { it.source?.text?.value?.startsWith("@") == true }
        if (mentions.isNotEmpty()) {
            val resources = mentions.count { it.source?.path == "git-changes" }
            put("hasMentions", "true")
            put("mentionCount", mentions.size.toString())
            put("fileMentionCount", (mentions.size - resources).toString())
            put("resourceMentionCount", resources.toString())
        }
    }

    private fun slashProps() = mapOf("hasSlashCommand" to "true", "slashCommandType" to "server")

    private fun bucket(text: String): String = when (text.length) {
        0 -> "empty"
        in 1..80 -> "short"
        in 81..500 -> "medium"
        else -> "long"
    }

    private fun connectionProps(): Map<String, String> = buildMap {
        put("appStatus", model.app.status.name)
        put("workspaceStatus", model.workspace.status.name)
        model.app.error?.let { put("appError", bucketError(it)) }
        model.workspace.error?.let { put("workspaceError", bucketError(it)) }
        put("warningCount", model.app.warnings.size.toString())
    }

    private fun bucketError(text: String): String = when {
        text.isBlank() -> "empty"
        text.contains("timed out", ignoreCase = true) -> "timeout"
        text.contains("not connected", ignoreCase = true) -> "not_connected"
        text.contains("connection", ignoreCase = true) -> "connection"
        text.contains("http", ignoreCase = true) -> "http"
        else -> "other"
    }

    fun dismissLoginRequired() {
        assertEdt()
        val active = model.state is SessionState.LoginRequired
        loginRetry = null
        if (active) {
            capture("Account Overlay Dismissed", sessionProps() + mapOf(
                "surface" to "session",
                "reason" to "paid_model_auth",
            ))
            updateModel { model.setState(SessionState.Idle) }
        }
    }

    private fun accountSnapshot(): SessionControllerEvent.AccountOverlaySnapshot {
        val state = model.app
        val prof = state.profile
        val pending = prof == null && state.progress?.profile == ProfileStatusDto.PENDING
        val current = when {
            prof != null -> prof
            pending -> lastProfile
            else -> null
        }
        if (prof != null) {
            lastProfile = prof
            if (target?.org == prof.currentOrgId) target = null
        }
        if (!pending && prof == null) {
            lastProfile = null
            target = null
        }
        return SessionControllerEvent.AccountOverlaySnapshot(
            status = state.status,
            profile = current,
            transient = pending,
            switching = target != null,
            targetOrgId = target?.org,
        )
    }

    private fun showAccountOverlay() {
        acctAllowed = true
        setAccountOverlayState(SessionControllerEvent.AccountOverlayChanged.Show(accountSnapshot()))
    }

    private fun hideAccountOverlay() {
        acctAllowed = false
        setAccountOverlayState(SessionControllerEvent.AccountOverlayChanged.Hide)
    }

    private fun refreshAccountOverlay() {
        if (!acctAllowed) return
        setAccountOverlayState(SessionControllerEvent.AccountOverlayChanged.Show(accountSnapshot()))
    }

    private fun setAccountOverlayState(event: SessionControllerEvent.AccountOverlayChanged) {
        if (acctState == event) return
        fire(event) {
            acctState = event
        }
    }

    fun refreshRecents(force: Boolean = false) {
        assertEdt()
        if (!canUseRecents()) return
        if (recentsState is RecentsState.Loading) return
        if (recentsState is RecentsState.Loaded && !force) return
        val state = RecentsState.Loading()
        setRecentSessionsState(state)
        cs.launch {
            try {
                val items = sessions.recent(directory, RECENT_LIMIT)
                edt {
                    if (!canUseRecents()) return@edt
                    if (recentsState != state) return@edt
                    setRecentSessionsState(RecentsState.Loaded)
                    if (!canUseRecents()) return@edt
                    setControllerViewState(SessionControllerEvent.ViewChanged.ShowRecents(items))
                }
            } catch (e: Exception) {
                LOG.warn("kind=session-recent dir=${ChatLogSummary.dir(directory)} failed message=${e.message}", e)
                edt {
                    if (!canUseRecents()) return@edt
                    if (recentsState != state) return@edt
                    setRecentSessionsState(RecentsState.Loaded)
                    if (!canUseRecents()) return@edt
                    setControllerViewState(SessionControllerEvent.ViewChanged.ShowRecents(emptyList()))
                }
            }
        }
    }

    private fun canUseRecents(): Boolean {
        assertEdt()
        if (disposed) return false
        if (ref != null) return false
        if (sessionLoadState !is SessionLoadState.Idle) return false
        return !model.showSession
    }

    private fun setControllerViewState(event: SessionControllerEvent.ViewChanged) {
        assertEdt()
        if (disposed) return
        if (event is SessionControllerEvent.ViewChanged.ShowSession) openLocal()
        if (viewState == event) return
        fire(event) {
            viewState = event
            if (event is SessionControllerEvent.ViewChanged.ShowSession) {
                model.showSession = true
                setSessionLoadState(SessionLoadState.Idle)
                setRecentSessionsState(RecentsState.Idle)
            }
        }
        when (event) {
            is SessionControllerEvent.ViewChanged.ShowRecents -> showAccountOverlay()
            is SessionControllerEvent.ViewChanged.ShowProgress -> hideAccountOverlay()
            is SessionControllerEvent.ViewChanged.ShowSession -> hideAccountOverlay()
        }
    }

    private fun openLocal() {
        val session = model.session ?: return
        open(SessionRef.Local(session))
    }

    private fun setConnectionTargetState(event: SessionControllerEvent.ConnectionChanged) {
        assertEdt()
        if (disposed) return
        connectionTargetState = event
        val state = event
        if (event is SessionControllerEvent.ConnectionChanged.Hide || event is SessionControllerEvent.ConnectionChanged.ShowWarning) {
            setVisibleConnectionState(event)
            return
        }
        if (connectionState == event) {
            return
        }
        connectionDelay.run(event, { if (connectionTargetState == state) state else resolveConnectionState() }) {
            if (!disposed) setVisibleConnectionState(it)
        }
    }

    private fun setVisibleConnectionState(event: SessionControllerEvent.ConnectionChanged) {
        assertEdt()
        if (disposed) return
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

    private fun setSessionLoadState(state: SessionLoadState) {
        assertEdt()
        sessionLoadState = state
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

        if (app.status == KiloAppStatusDto.DOWNLOADING) {
            return SessionControllerEvent.ConnectionChanged.ShowDownloading(
                app.downloadPercent ?: 0,
                app.downloadVersion,
                app.downloadPlatform,
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
        LOG.debug { "session=${sid ?: ref?.key ?: "pending"} controller: $event" }
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) {
            if (disposed) return
            before?.invoke()
            for (l in listeners) l.onEvent(event)
            return
        }
        application.invokeLater {
            if (disposed) return@invokeLater
            before?.invoke()
            for (l in listeners) l.onEvent(event)
        }
    }

    private fun replay(listener: SessionControllerListener) {
        if (disposed) return
        val app = ApplicationManager.getApplication()
        val block: () -> Unit = {
            if (!disposed) {
                viewState?.let(listener::onEvent)
                listener.onEvent(acctState)
                connectionState?.let(listener::onEvent)
            }
        }
        if (app.isDispatchThread) {
            if (disposed) return
            block()
            return
        }
        app.invokeLater {
            if (disposed) return@invokeLater
            block()
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
        runEdt {
            if (disposed) return@runEdt
            disposed = true
            connectionDelay.dispose()
            cancelSubscriptions()
            drainJob?.cancel()
            drainJob = null
            revertWatchdog?.stop()
            revertWatchdog = null
            revertJob?.cancel()
            revertJob = null
            revertOp = null
            revertDeferred = null
            val callbacks = enhancements.values.toList()
            enhancements.clear()
            cs.cancel()
            val result = Result.failure<String>(CancellationException("Session controller disposed"))
            callbacks.forEach { it(result) }
        }
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
            is SessionState.Loading -> out.add("[loading]")
            is SessionState.Busy -> {
                out.add("[busy]")
                out.add("[${state.text.toDumpText()}]")
            }
            is SessionState.Reverting -> {
                out.add("[reverting]")
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
            is SessionState.LoginRequired -> {
                out.add("[login-required]")
                out.add("[${state.message}]")
            }
        }

        return out.joinToString(" ")
    }
}

/** Extracts the child session ID from a task tool part's metadata, or null if not a task part. */
private fun childID(part: PartDto): String? {
    if (part.type != "tool" || part.tool != "task") return null
    return part.metadata["sessionId"]
}

private data class PartKey(val messageId: String, val partId: String)

private fun children(items: List<MessageWithPartsDto>): Map<PartKey, String> = buildMap {
    for (msg in items) {
        for (part in msg.parts) {
            childID(part)?.let { put(PartKey(msg.info.id, part.id), it) }
        }
    }
}

/** Returns true when [event] should be routed from a child subscription. */
private fun isChildEvent(event: ChatEventDto, child: String): Boolean = when (event) {
    is ChatEventDto.PartUpdated -> event.sessionID == child
    is ChatEventDto.PartRemoved -> event.sessionID == child
    is ChatEventDto.PermissionAsked -> event.sessionID == child
    is ChatEventDto.PermissionReplied -> event.sessionID == child
    else -> false
}

/** Returns true when [event]'s sessionID matches [id] (or event has no sessionID, like Error). */
private fun matchesSession(event: ChatEventDto, id: String): Boolean = when (event) {
    is ChatEventDto.MessageUpdated -> event.sessionID == id
    is ChatEventDto.PartUpdated -> event.sessionID == id
    is ChatEventDto.PartDelta -> event.sessionID == id
    is ChatEventDto.PartRemoved -> event.sessionID == id
    is ChatEventDto.TurnOpen -> event.sessionID == id
    is ChatEventDto.TurnClose -> event.sessionID == id
    is ChatEventDto.SessionCreated -> true
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

private fun pathKey(value: String): String = runCatching {
    Path.of(value).normalize().toString().trimEnd('/', '\\')
}.getOrElse {
    value.replace('\\', '/').trimEnd('/')
}

private sealed interface RecentsState {
    data object Idle : RecentsState
    data class Loading(val id: Any = Any()) : RecentsState
    data object Loaded : RecentsState
}

private sealed interface SessionLoadState {
    data object Idle : SessionLoadState
    data class Loading(val id: Any = Any()) : SessionLoadState
}

internal data class ControllerStateSnapshot(
    val showSession: Boolean,
    val viewState: SessionControllerEvent.ViewChanged?,
    val connectionState: SessionControllerEvent.ConnectionChanged?,
    val connectionTargetState: SessionControllerEvent.ConnectionChanged?,
    val refKey: String?,
    val refType: String?,
    val sessionLoadState: String,
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
    val state = dto.metadata["state"]?.let { raw ->
        PermissionRequestState.values().firstOrNull { item -> item.name.equals(raw, ignoreCase = true) }
    } ?: PermissionRequestState.PENDING
    val diffs = dto.fileDiffs.map {
        PermissionFileDiff(
            file = it.file,
            patch = it.patch,
            before = it.before,
            after = it.after,
            additions = it.additions,
            deletions = it.deletions,
        )
    }
    val file = dto.filePath
        ?: dto.metadata["filepath"]
        ?: dto.metadata["filePath"]
        ?: dto.metadata["file"]
        ?: dto.metadata["path"]
    val patterns = dto.rules.ifEmpty { dto.always }
    val rules = dto.ruleDecisions.map { it.toRuleCandidate() }
        .ifEmpty { patterns.map { PermissionRuleCandidate(it) } }
    return Permission(
        id = dto.id,
        sessionId = dto.sessionID,
        name = dto.permission,
        patterns = dto.patterns,
        always = dto.always,
        meta = PermissionMeta(
            command = dto.command ?: dto.metadata["command"],
            rules = patterns,
            ruleDecisions = rules,
            diff = dto.metadata["diff"],
            filePath = file,
            fileDiff = diffs.firstOrNull(),
            fileDiffs = diffs,
            raw = dto.metadata,
        ),
        message = dto.message ?: dto.metadata["message"],
        tool = ref,
        state = state,
    )
}

private fun PermissionRuleDecisionDto.toRuleCandidate(): PermissionRuleCandidate {
    val next = decision.toPermissionRuleDecision()
    val default = defaultDecision.toPermissionRuleDecision()
    return PermissionRuleCandidate(pattern, next, default)
}

private fun String.toPermissionRuleDecision(): PermissionRuleDecision {
    return when (lowercase()) {
        "approved", "allow" -> PermissionRuleDecision.APPROVED
        "denied", "deny" -> PermissionRuleDecision.DENIED
        else -> PermissionRuleDecision.PENDING
    }
}

private fun toQuestion(dto: QuestionRequestDto): Question {
    val ref = dto.tool?.let { ToolCallRef(it.messageID, it.callID) }
    val items = dto.questions.map {
        QuestionItem(
            question = it.question,
            header = it.header,
            options = it.options.map { opt ->
                QuestionOption(
                    label = opt.label,
                    description = opt.description,
                    labelKey = opt.labelKey,
                    descriptionKey = opt.descriptionKey,
                    mode = opt.mode,
                )
            },
            multiple = it.multiple,
            custom = it.custom,
            questionKey = it.questionKey,
            headerKey = it.headerKey,
        )
    }
    return Question(id = dto.id, items = items, tool = ref, blocking = dto.blocking)
}

private fun String.toDumpText(): String {
    val text = lowercase()
        .replace("\u2026", "")
        .replace("…", "")
        .replace(Regex("[^a-z0-9]+"), " ")
        .trim()
    return text
}
