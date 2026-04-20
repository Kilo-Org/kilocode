package ai.kilocode.client.session.model

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Session lifecycle controller for a single session.
 *
 * Accepts an optional [id] — if non-null, loads that session immediately.
 * If null, lazily creates a session on the first [prompt] call. This
 * ensures event subscription happens *before* the prompt is sent,
 * eliminating race conditions.
 *
 * Owns [SessionState] and the listener list. All model mutations and
 * listener notifications happen on the EDT — [fire] auto-dispatches
 * via `invokeLater` when called from a background thread.
 */
class SessionModel(
    parent: Disposable,
    id: String?,
    private val sessions: KiloSessionService,
    private val workspace: Workspace,
    private val app: KiloAppService,
    private val cs: CoroutineScope,
) : Disposable {

    companion object {
        private val LOG = Logger.getInstance(SessionModel::class.java)
    }

    init {
        Disposer.register(parent, this)
    }

    val chat = SessionState()

    private val listeners = mutableListOf<SessionModelListener>()

    /** The session ID owned by this model. Null until created or passed in. */
    private var sessionId: String? = id

    /** Resolved project directory for RPC calls. */
    private val directory: String get() = workspace.directory

    // Status computation state (EDT-only)
    private var partType: String? = null
    private var tool: String? = null
    private var busy: Boolean = false

    // Coroutine job for the current event subscription
    private var eventJob: Job? = null

    // --- Listener management (EDT) ---

    /**
     * Register a listener whose lifetime is tied to [parent].
     * When [parent] is disposed the listener is auto-removed.
     */
    fun addListener(parent: Disposable, listener: SessionModelListener) {
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
    }

    // --- Actions (called from EDT) ---

    /**
     * Send a prompt. If no session exists, creates one first,
     * subscribes to events, then sends the prompt — all in one
     * coroutine to avoid race conditions.
     */
    fun prompt(text: String) {
        showMessages()
        cs.launch {
            try {
                val id = sessionId ?: run {
                    val session = sessions.create(directory)
                    sessionId = session.id
                    subscribeEvents()
                    session.id
                }
                sessions.prompt(id, directory, text)
            } catch (e: Exception) {
                LOG.warn("prompt failed", e)
                edt {
                    fire(SessionEvent.Error(e.message ?: KiloBundle.message("session.error.prompt")))
                    fire(SessionEvent.BusyChanged(false))
                }
            }
        }
    }

    fun abort() {
        val id = sessionId ?: return
        cs.launch {
            try {
                sessions.abort(id, directory)
            } catch (e: Exception) {
                LOG.warn("abort failed", e)
            }
        }
    }

    fun selectAgent(name: String) {
        chat.agent = name
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(agent = name))
            } catch (e: Exception) {
                LOG.warn("selectAgent failed", e)
            }
        }
        fire(SessionEvent.WorkspaceReady)
    }

    fun selectModel(provider: String, id: String) {
        chat.model = "$provider/$id"
        cs.launch {
            try {
                sessions.updateConfig(directory, ConfigUpdateDto(model = "$provider/$id"))
            } catch (e: Exception) {
                LOG.warn("selectModel failed", e)
            }
        }
        fire(SessionEvent.WorkspaceReady)
    }

    // --- Internal: coroutine → EDT bridge ---

    init {
        // If we have a session ID, load it immediately
        if (sessionId != null) {
            loadHistory()
            subscribeEvents()
        }

        // Watch session statuses for busy/idle
        cs.launch {
            sessions.statuses.collect { statuses ->
                val id = sessionId ?: return@collect
                val st = statuses[id]
                edt { fire(SessionEvent.BusyChanged(st?.type == "busy")) }
            }
        }

        // Watch app lifecycle state
        app.connect()
        cs.launch {
            app.state.collect { state ->
                if (state.status == KiloAppStatusDto.READY) app.fetchVersionAsync()
                edt {
                    chat.app = state
                    chat.version = app.version
                    fire(SessionEvent.AppChanged)
                }
            }
        }

        // Watch workspace state for providers/agents and lifecycle
        cs.launch {
            workspace.state.collect { state ->
                edt {
                    chat.workspace = state
                    fire(SessionEvent.WorkspaceChanged)

                    if (state.status == KiloWorkspaceStatusDto.READY) {
                        chat.agents = state.agents?.agents?.map {
                            AgentItem(it.name, it.displayName ?: it.name)
                        } ?: emptyList()

                        chat.models = state.providers?.let { providers ->
                            providers.providers
                                .filter { it.id in providers.connected }
                                .flatMap { provider ->
                                    provider.models.map { (id, info) ->
                                        ModelItem(id, info.name, provider.id)
                                    }
                                }
                        } ?: emptyList()

                        if (chat.agent == null) {
                            chat.agent = state.agents?.default
                        }
                        if (chat.model == null) {
                            chat.model = state.providers?.defaults?.entries?.firstOrNull()?.value
                        }

                        chat.ready = true
                        fire(SessionEvent.WorkspaceReady)
                    }
                }
            }
        }
    }

    private fun loadHistory() {
        val id = sessionId ?: return
        cs.launch {
            try {
                val history = sessions.messages(id, directory)
                edt {
                    chat.load(history)
                    if (!chat.isEmpty()) showMessages()
                    fire(SessionEvent.HistoryLoaded)
                }
            } catch (e: Exception) {
                LOG.warn("loadHistory failed", e)
            }
        }
    }

    private fun subscribeEvents() {
        val id = sessionId ?: return
        eventJob?.cancel()
        eventJob = cs.launch {
            sessions.events(id, directory).collect { event ->
                edt { handle(event) }
            }
        }
    }

    private fun handle(event: ChatEventDto) {
        when (event) {
            is ChatEventDto.MessageUpdated -> {
                chat.addMessage(event.info)
                showMessages()
                fire(SessionEvent.MessageAdded(event.info.id))
            }

            is ChatEventDto.PartUpdated -> {
                partType = event.part.type
                tool = event.part.tool
                chat.updatePart(event.part.messageID, event.part)
                if (busy) {
                    fire(SessionEvent.StatusChanged(status()))
                }
                if (event.part.type == "text" && event.part.text != null) {
                    fire(SessionEvent.PartUpdated(event.part.messageID, event.part.id))
                }
            }

            is ChatEventDto.PartDelta -> {
                if (event.field == "text") {
                    chat.appendDelta(event.messageID, event.partID, event.delta)
                    fire(SessionEvent.PartDelta(event.messageID, event.partID, event.delta))
                }
            }

            is ChatEventDto.TurnOpen -> {
                partType = null
                tool = null
                busy = true
                fire(SessionEvent.StatusChanged(KiloBundle.message("session.status.considering")))
                fire(SessionEvent.BusyChanged(true))
            }

            is ChatEventDto.TurnClose -> {
                partType = null
                tool = null
                busy = false
                fire(SessionEvent.StatusChanged(null))
                fire(SessionEvent.BusyChanged(false))
            }

            is ChatEventDto.Error -> {
                val msg = event.error?.message ?: event.error?.type ?: KiloBundle.message("session.error.unknown")
                busy = false
                fire(SessionEvent.Error(msg))
                fire(SessionEvent.StatusChanged(null))
                fire(SessionEvent.BusyChanged(false))
            }

            is ChatEventDto.MessageRemoved -> {
                chat.removeMessage(event.messageID)
                fire(SessionEvent.MessageRemoved(event.messageID))
            }
        }
    }

    // --- View switching (EDT) ---

    private fun showMessages() {
        if (!chat.showMessages) {
            chat.showMessages = true
            fire(SessionEvent.ViewChanged(true))
        }
    }

    private fun hideMessages() {
        if (chat.showMessages) {
            chat.showMessages = false
            fire(SessionEvent.ViewChanged(false))
        }
    }

    /**
     * Compute a human-readable status from the last streaming part.
     */
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

    /**
     * Notify all listeners. If called from the EDT, listeners run
     * immediately. If called from a background thread, the notification
     * is dispatched via `invokeLater`.
     */
    private fun fire(event: SessionEvent) {
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) {
            for (l in listeners) l.onEvent(event)
        } else {
            application.invokeLater { for (l in listeners) l.onEvent(event) }
        }
    }

    private fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(block)
    }

    override fun dispose() {
        eventJob?.cancel()
        cs.cancel()
    }
}
