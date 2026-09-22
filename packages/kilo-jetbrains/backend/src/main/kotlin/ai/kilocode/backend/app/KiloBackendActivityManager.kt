package ai.kilocode.backend.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.ToolRefDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Tracks live per-session activity (busy + pending question/permission)
 * with each session's directory, exposed to the frontend so the Agent
 * Manager worktree list can badge rows.
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService] which
 * calls [start] after [KiloAppState.Ready] and [stop] on disconnect.
 *
 * Baseline `busy` comes from the session status stream; question/permission
 * overlays come from the global chat events. State is confined to a single
 * lock so the two collectors don't race.
 */
class KiloBackendActivityManager(
    private val cs: CoroutineScope,
    private val log: KiloLog,
) {
    companion object {
        private const val RESOLVED_LIMIT = 256
    }

    private data class Pending(
        val tool: ToolRefDto?,
        val plan: Boolean = false,
    )

    private val permissions = mutableMapOf<String, MutableMap<String, Pending>>()
    private val questions = mutableMapOf<String, MutableMap<String, Pending>>()
    private val resolved = LinkedHashSet<String>()
    private val errors = mutableSetOf<String>()
    private val lock = Any()
    private val _activity = MutableStateFlow<Map<String, SessionActivityDto>>(emptyMap())
    val activity: StateFlow<Map<String, SessionActivityDto>> = _activity.asStateFlow()

    private var statuses: StateFlow<Map<String, SessionStatusDto>>? = null
    private var directory: (String) -> String? = { null }
    private var status: Job? = null
    private var events: Job? = null

    fun start(
        statuses: StateFlow<Map<String, SessionStatusDto>>,
        directory: (String) -> String?,
        chatEvents: SharedFlow<ChatEventDto>,
    ) {
        if (status?.isActive == true || events?.isActive == true) detach()
        this.statuses = statuses
        this.directory = directory
        status = cs.launch {
            statuses.collect { synchronized(lock) { recompute() } }
        }
        events = cs.launch {
            chatEvents.collect { event ->
                synchronized(lock) {
                    handle(event)
                    recompute()
                }
            }
        }
        log.info("Activity manager started")
    }

    fun stop() {
        detach()
        statuses = null
        directory = { null }
        synchronized(lock) {
            permissions.clear()
            questions.clear()
            resolved.clear()
            errors.clear()
        }
        _activity.value = emptyMap()
        log.info("Activity manager stopped")
    }

    /**
     * Cancels the collectors without discarding what they recorded.
     *
     * [start] runs on every reload, including the one a disposal triggers in the same breath as
     * cancelling the running turns. Clearing state there would erase the interruption badges that
     * disposal just recorded, so an in-place restart keeps them and lets fresh collectors carry on.
     * A real teardown still goes through [stop].
     */
    private fun detach() {
        status?.cancel()
        events?.cancel()
        status = null
        events = null
    }

    /**
     * Badge [ids] as having lost a turn nobody asked to stop.
     *
     * Called directly instead of being driven from [ChatEventDto.SessionInterrupted]: the disposal that
     * cancels those turns reloads the app immediately, the reload restarts the event collector, and the
     * chat event flow replays nothing — an emission racing that restart can land in the gap where
     * nothing is subscribed and be dropped. A direct call is ordered with the disposal that caused it.
     */
    fun interrupt(ids: Collection<String>) {
        if (ids.isEmpty()) return
        synchronized(lock) {
            errors.addAll(ids)
            recompute()
        }
    }

    /** Remove a prompt once the CLI confirms it is no longer pending, without waiting for the SSE echo. */
    fun resolve(id: String) {
        synchronized(lock) {
            val permission = permissions.entries.firstOrNull { id in it.value }
            if (permission != null) remove(permissions, permission.key, id)
            val question = questions.entries.firstOrNull { id in it.value }
            if (question != null) remove(questions, question.key, id)
            if (permission == null && question == null) {
                resolved.add(id)
                if (resolved.size > RESOLVED_LIMIT) resolved.remove(resolved.first())
                return
            }
            recompute()
        }
    }

    private fun handle(event: ChatEventDto) {
        when (event) {
            is ChatEventDto.PermissionAsked -> ask(
                permissions,
                event.sessionID,
                event.request.id,
                Pending(event.request.tool),
            )
            is ChatEventDto.PermissionReplied -> remove(permissions, event.sessionID, event.requestID)
            is ChatEventDto.QuestionAsked -> ask(
                questions,
                event.sessionID,
                event.request.id,
                Pending(event.request.tool, plan(event)),
            )
            is ChatEventDto.QuestionReplied -> remove(questions, event.sessionID, event.requestID)
            is ChatEventDto.QuestionRejected -> remove(questions, event.sessionID, event.requestID)
            is ChatEventDto.PartUpdated -> advance(event)
            // A Stop publishes MessageAbortedError. That is a deliberate user action, not a failure, so
            // it must not badge the session list, worktree rows, or the Agents tab attention dot.
            is ChatEventDto.Error -> if (event.error?.aborted != true) event.sessionID?.let { errors.add(it) }
            // A cancellation nobody asked for is a failure, but the abort reporting it is
            // indistinguishable from a Stop, so that badge arrives through [interrupt] instead.
            is ChatEventDto.TurnOpen -> errors.remove(event.sessionID)
            // Not every failure publishes a session error — a turn whose provider ended the response in
            // error writes the failure onto the message and only reports it through this close reason. The
            // badge has to come from the close too, or such a session rests as if it finished cleanly.
            is ChatEventDto.TurnClose -> {
                permissions.remove(event.sessionID)
                close(event)
                if (event.reason == "error") errors.add(event.sessionID)
            }
            is ChatEventDto.SessionIdle -> clear(event.sessionID)
            is ChatEventDto.SessionStatusChanged -> when (event.status.type) {
                "idle" -> clear(event.sessionID)
                // Work restarted, so whatever ended the previous turn is stale. Not every resume
                // path publishes a turn event, so busy has to clear the error itself.
                "busy" -> errors.remove(event.sessionID)
                else -> Unit
            }
            else -> Unit
        }
    }

    private fun recompute() {
        val current = statuses?.value ?: emptyMap()
        val ids = LinkedHashSet<String>()
        ids.addAll(current.filterValues { it.type == "busy" }.keys)
        ids.addAll(permissions.keys)
        ids.addAll(questions.keys)
        ids.addAll(errors)
        _activity.value = ids.mapNotNull { id ->
            val dir = directory(id) ?: return@mapNotNull null
            val kind = kind(id, current[id]?.type == "busy") ?: return@mapNotNull null
            id to SessionActivityDto(dir, kind)
        }.toMap()
    }

    private fun kind(id: String, busy: Boolean): SessionActivityKindDto? {
        if (permissions[id]?.isNotEmpty() == true) return SessionActivityKindDto.PERMISSION
        val pending = questions[id]
        if (pending?.isNotEmpty() == true) {
            if (pending.values.any { it.plan }) return SessionActivityKindDto.PLAN
            return SessionActivityKindDto.QUESTION
        }
        // Live work outranks a past error: the status stream and the chat events are separate
        // collectors, so a resumed session can go busy before the event that clears its error
        // arrives, and the row must keep spinning instead of resting on the stale error.
        if (busy) return SessionActivityKindDto.RUNNING
        if (id in errors) return SessionActivityKindDto.ERROR
        return null
    }

    private fun plan(event: ChatEventDto.QuestionAsked): Boolean =
        event.request.questions.any { it.questionKey == "plan.followup.question" || it.headerKey == "plan.followup.header" }

    private fun clear(id: String) {
        permissions.remove(id)
        questions.remove(id)
    }

    private fun advance(event: ChatEventDto.PartUpdated) {
        when (event.part.state) {
            "completed", "error" -> {
                finish(permissions, event)
                finish(questions, event)
            }
            else -> Unit
        }
    }

    private fun close(event: ChatEventDto.TurnClose) {
        if (event.reason != "completed") {
            questions.remove(event.sessionID)
            return
        }
        // Plan follow-ups are deliberately asked after the turn and have no tool reference. A
        // tool-backed question cannot outlive a completed turn, even if its terminal part was missed.
        val items = questions[event.sessionID] ?: return
        items.entries.removeIf { it.value.tool != null }
        if (items.isEmpty()) questions.remove(event.sessionID)
    }

    private fun finish(map: MutableMap<String, MutableMap<String, Pending>>, event: ChatEventDto.PartUpdated) {
        val items = map[event.sessionID] ?: return
        items.entries.removeIf { item ->
            val tool = item.value.tool ?: return@removeIf false
            tool.messageID == event.part.messageID && tool.callID == event.part.callID
        }
        if (items.isEmpty()) map.remove(event.sessionID)
    }

    private fun ask(map: MutableMap<String, MutableMap<String, Pending>>, id: String, request: String, pending: Pending) {
        if (resolved.remove(request)) return
        map.getOrPut(id) { mutableMapOf() }[request] = pending
    }

    private fun remove(map: MutableMap<String, MutableMap<String, Pending>>, id: String, value: String) {
        val items = map[id] ?: return
        items.remove(value)
        if (items.isEmpty()) map.remove(id)
    }
}
