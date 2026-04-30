package ai.kilocode.client.session.update

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.SessionStatusDto

class TurnLifecycleTest : SessionControllerTestBase() {

    fun `test TurnOpen fires StateChanged to Busy`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test TurnClose fires StateChanged to Idle`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.TurnClose("ses_test", "completed"))

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test TurnClose error reason does not clobber Error state`() {
        val (m, _, _) = prompted()

        // Error event arrives just before TurnClose
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = "Timed out")))
        emit(ChatEventDto.TurnClose("ses_test", "error"))

        // Error state must survive
        assertSession(
            """
            [code] [kilo/gpt-5] [error] [Timed out]
            """,
            m,
        )
    }

    fun `test TurnClose completed clobbers Error state`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = "Timed out")))
        emit(ChatEventDto.TurnClose("ses_test", "completed"))

        // "completed" always wins over error
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test Error fires StateChanged to Error`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "APIError", message = "Bad Request")))

        assertSession(
            """
            [code] [kilo/gpt-5] [error] [Bad Request]
            """,
            m,
        )
    }

    fun `test Error with null message falls back to type`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = null)))

        assertSession(
            """
            [code] [kilo/gpt-5] [error] [timeout]
            """,
            m,
        )
    }

    fun `test SessionStatusChanged retry with full detail`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.SessionStatusChanged(
            "ses_test",
            SessionStatusDto("retry", "Rate limited", attempt = 2, next = 5000L),
        ))

        val state = m.model.state as SessionState.Retry
        assertEquals("Rate limited", state.message)
        assertEquals(2, state.attempt)
        assertEquals(5000L, state.next)
    }

    fun `test SessionStatusChanged offline with requestID`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.SessionStatusChanged(
            "ses_test",
            SessionStatusDto("offline", "No network", requestID = "req_abc"),
        ))

        val state = m.model.state as SessionState.Offline
        assertEquals("No network", state.message)
        assertEquals("req_abc", state.requestId)
    }

    fun `test SessionIdle transitions to Idle from Busy`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.SessionIdle("ses_test"))

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test SessionIdle does not clobber Error state`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = "Timed out")))
        emit(ChatEventDto.SessionIdle("ses_test"))

        // Error state must survive
        assertSession(
            """
            [code] [kilo/gpt-5] [error] [Timed out]
            """,
            m,
        )
    }

    fun `test events for wrong session are ignored`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.TurnOpen("ses_other"))

        // No state change — event was filtered out
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
        assertModelEvents("", modelEvents)
    }
}
