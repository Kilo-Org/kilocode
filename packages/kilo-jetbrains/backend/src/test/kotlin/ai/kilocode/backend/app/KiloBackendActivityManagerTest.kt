package ai.kilocode.backend.app

import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class KiloBackendActivityManagerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val events = MutableSharedFlow<ChatEventDto>(extraBufferCapacity = 16)
    private val statuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
    private val directories = mutableMapOf<String, String>()
    private val manager = KiloBackendActivityManager(scope, TestLog())

    @AfterTest
    fun tearDown() {
        manager.stop()
        scope.cancel()
    }

    /**
     * Starts the manager and waits until its event collector has subscribed. [events] has no
     * replay, so an emit before that point is silently discarded and the test hangs.
     */
    private suspend fun start() {
        manager.start(statuses, { directories[it] }, events)
        withTimeout(5_000) { events.subscriptionCount.first { it > 0 } }
    }

    @Test
    fun `busy status with known directory emits running activity`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        start()

        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))

        val snap = await("ses_1", SessionActivityKindDto.RUNNING)
        assertEquals("/repo/wt", snap["ses_1"]?.directory)
    }

    @Test
    fun `permission asked overlays running and reply reverts`() = runBlocking<Unit> {
        directories["ses_1"] = "/repo/wt"
        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        start()

        events.emit(ChatEventDto.PermissionAsked("ses_1", PermissionRequestDto("perm_1", "ses_1", "edit", emptyList())))
        await("ses_1", SessionActivityKindDto.PERMISSION)

        events.emit(ChatEventDto.PermissionReplied("ses_1", "perm_1"))

        await("ses_1", SessionActivityKindDto.RUNNING)
    }

    @Test
    fun `question kinds distinguish plain and plan followup`() = runBlocking<Unit> {
        directories["ses_plain"] = "/repo/a"
        directories["ses_plan"] = "/repo/b"
        start()

        events.emit(ChatEventDto.QuestionAsked("ses_plain", question("q_1", "ses_plain")))
        events.emit(ChatEventDto.QuestionAsked("ses_plan", question("q_2", "ses_plan", plan = true)))

        await("ses_plain", SessionActivityKindDto.QUESTION)
        await("ses_plan", SessionActivityKindDto.PLAN)
    }

    @Test
    fun `idle clears pending overlays and removes inactive entry`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        start()
        events.emit(ChatEventDto.QuestionAsked("ses_1", question("q_1", "ses_1")))
        await("ses_1", SessionActivityKindDto.QUESTION)

        statuses.value = mapOf("ses_1" to SessionStatusDto("idle"))
        events.emit(ChatEventDto.SessionIdle("ses_1"))

        withTimeout(5_000) { manager.activity.first { "ses_1" !in it } }
        assertFalse("ses_1" in manager.activity.value)
    }

    @Test
    fun `error persists through idle and clears on next turn`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        start()

        // Turn ends on an error: the session goes idle but the error must stay visible.
        events.emit(ChatEventDto.Error("ses_1"))
        statuses.value = mapOf("ses_1" to SessionStatusDto("idle"))
        events.emit(ChatEventDto.SessionIdle("ses_1"))
        await("ses_1", SessionActivityKindDto.ERROR)

        // A new turn clears the error.
        events.emit(ChatEventDto.TurnOpen("ses_1"))
        withTimeout(5_000) { manager.activity.first { "ses_1" !in it } }
        assertFalse("ses_1" in manager.activity.value)
    }

    @Test
    fun `aborted error does not badge the session`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))
        start()
        await("ses_1", SessionActivityKindDto.RUNNING)

        events.emit(ChatEventDto.Error("ses_1", MessageErrorDto(MessageErrorDto.ABORTED, "aborted")))
        statuses.value = mapOf("ses_1" to SessionStatusDto("idle"))
        events.emit(ChatEventDto.SessionIdle("ses_1"))

        withTimeout(5_000) { manager.activity.first { "ses_1" !in it } }
        assertFalse("ses_1" in manager.activity.value)
    }

    @Test
    fun `busy outranks a pending provider error so a resumed session runs`() = runBlocking<Unit> {
        directories["ses_1"] = "/repo/wt"
        start()

        events.emit(ChatEventDto.Error("ses_1", MessageErrorDto("APIError", "Provider failed")))
        await("ses_1", SessionActivityKindDto.ERROR)

        // Resumed: busy arrives before anything clears the error.
        statuses.value = mapOf("ses_1" to SessionStatusDto("busy"))

        await("ses_1", SessionActivityKindDto.RUNNING)
    }

    @Test
    fun `busy status event clears a pending error`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        start()

        events.emit(ChatEventDto.Error("ses_1"))
        await("ses_1", SessionActivityKindDto.ERROR)

        events.emit(ChatEventDto.SessionStatusChanged("ses_1", SessionStatusDto("busy")))

        withTimeout(5_000) { manager.activity.first { "ses_1" !in it } }
        assertFalse("ses_1" in manager.activity.value)
    }

    @Test
    fun `global error without session is ignored`() = runBlocking {
        directories["ses_1"] = "/repo/wt"
        start()

        events.emit(ChatEventDto.Error(null))
        events.emit(ChatEventDto.QuestionAsked("ses_1", question("q_1", "ses_1")))

        val snap = await("ses_1", SessionActivityKindDto.QUESTION)
        assertEquals(1, snap.size)
    }

    @Test
    fun `unknown session directory is omitted`() = runBlocking {
        directories["ses_known"] = "/repo/wt"
        start()

        statuses.value = mapOf(
            "ses_known" to SessionStatusDto("busy"),
            "ses_unknown" to SessionStatusDto("busy"),
        )

        val snap = await("ses_known", SessionActivityKindDto.RUNNING)
        assertFalse("ses_unknown" in snap)
    }

    @Test
    fun `start rebinds collectors to the latest flows`() = runBlocking {
        val nextStatuses = MutableStateFlow<Map<String, SessionStatusDto>>(emptyMap())
        val nextEvents = MutableSharedFlow<ChatEventDto>(extraBufferCapacity = 16)
        directories["ses_old"] = "/repo/old"
        directories["ses_new"] = "/repo/new"
        start()

        manager.start(nextStatuses, { directories[it] }, nextEvents)
        statuses.value = mapOf("ses_old" to SessionStatusDto("busy"))
        nextStatuses.value = mapOf("ses_new" to SessionStatusDto("busy"))

        val snap = await("ses_new", SessionActivityKindDto.RUNNING)
        assertFalse("ses_old" in snap)
        assertEquals("/repo/new", snap["ses_new"]?.directory)
    }

    private suspend fun await(id: String, kind: SessionActivityKindDto) = withTimeout(5_000) {
        manager.activity.first { it[id]?.kind == kind }
    }

    private fun question(id: String, session: String, plan: Boolean = false): QuestionRequestDto {
        val info = if (plan) {
            QuestionInfoDto(
                question = "Ready to implement?",
                header = "Implement",
                questionKey = "plan.followup.question",
                headerKey = "plan.followup.header",
            )
        } else {
            QuestionInfoDto(question = "Pick one", header = "Choice")
        }
        return QuestionRequestDto(id = id, sessionID = session, questions = listOf(info))
    }
}
