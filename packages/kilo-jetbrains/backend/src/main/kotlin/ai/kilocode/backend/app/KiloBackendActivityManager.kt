package ai.kilocode.backend.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.SessionStatusDto
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
    private val permissions = mutableMapOf<String, MutableSet<String>>()
    private val questions = mutableMapOf<String, MutableMap<String, Boolean>>()
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
        if (status?.isActive == true || events?.isActive == true) stop()
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
        status?.cancel()
        events?.cancel()
        status = null
        events = null
        statuses = null
        directory = { null }
        synchronized(lock) {
            permissions.clear()
            questions.clear()
            errors.clear()
        }
        _activity.value = emptyMap()
        log.info("Activity manager stopped")
    }

    private fun handle(event: ChatEventDto) {
        when (event) {
            is ChatEventDto.PermissionAsked -> permissions.getOrPut(event.sessionID) { mutableSetOf() }.add(event.request.id)
            is ChatEventDto.PermissionReplied -> removeSet(permissions, event.sessionID, event.requestID)
            is ChatEventDto.QuestionAsked -> questions.getOrPut(event.sessionID) { mutableMapOf() }[event.request.id] = plan(event)
            is ChatEventDto.QuestionReplied -> removeMap(questions, event.sessionID, event.requestID)
            is ChatEventDto.QuestionRejected -> removeMap(questions, event.sessionID, event.requestID)
            // A Stop publishes MessageAbortedError. That is a deliberate user action, not a failure, so
            // it must not badge the session list, worktree rows, or the Agents tab attention dot.
            is ChatEventDto.Error -> if (event.error?.aborted != true) event.sessionID?.let { errors.add(it) }
            is ChatEventDto.TurnOpen -> errors.remove(event.sessionID)
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
            if (pending.values.any { it }) return SessionActivityKindDto.PLAN
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

    private fun <T> removeSet(map: MutableMap<String, MutableSet<T>>, id: String, value: T) {
        val set = map[id] ?: return
        set.remove(value)
        if (set.isEmpty()) map.remove(id)
    }

    private fun <T> removeMap(map: MutableMap<String, MutableMap<T, Boolean>>, id: String, value: T) {
        val items = map[id] ?: return
        items.remove(value)
        if (items.isEmpty()) map.remove(id)
    }
}
