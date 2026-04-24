package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.coroutines.flow.flow

class ChatLoggingFlowTest : SessionControllerTestBase() {

    fun `test prompt creates session and subscribes before dispatch`() {
        projectRpc.state.value = workspaceReady()
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        val m = controller()
        flush()

        edt { m.prompt("hello") }
        flush()

        assertEquals(1, rpc.creates)
        assertEquals(1, rpc.prompts.size)
        assertEquals("ses_test", rpc.prompts[0].first)
    }

    fun `test subscribeEvents drops foreign session events`() {
        rpc.eventFlow = { _, _ ->
            flow {
                emit(ChatEventDto.TurnOpen("ses_other"))
                emit(ChatEventDto.TurnOpen("ses_test"))
            }
        }
        val m = controller("ses_test")
        val modelEvents = collectModelEvents(m)
        flush()

        val states = modelEvents.filterIsInstance<SessionModelEvent.StateChanged>()
        assertEquals(1, states.size)
        assertEquals("StateChanged Busy", states.joinToString("\n"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test recoverPending prefers permission over question and status`() {
        rpc.pendingPermissionList += PermissionRequestDto(
            id = "req_1",
            sessionID = "ses_test",
            permission = "edit",
            patterns = listOf("*.kt"),
        )
        rpc.pendingQuestionList += QuestionRequestDto(
            id = "req_q",
            sessionID = "ses_test",
            questions = listOf(QuestionInfoDto("Pick", "Header")),
        )
        rpc.statuses.value = mapOf(
            "ses_test" to SessionStatusDto(type = "offline", requestID = "req_offline")
        )

        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        assertEquals("req_1", (m.model.state as SessionState.AwaitingPermission).permission.id)
    }
}
