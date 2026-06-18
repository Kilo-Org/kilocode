package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
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

    fun `test TurnClose completed preserves AwaitingQuestion state`() {
        val (m, _, _) = prompted()

        emit(
            ChatEventDto.QuestionAsked(
                "ses_test",
                QuestionRequestDto("q1", "ses_test", listOf(QuestionInfoDto("Pick one", "Choice"))),
            ),
        )
        emit(ChatEventDto.TurnClose("ses_test", "completed"))

        assertTrue(m.model.state is SessionState.AwaitingQuestion)
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

    fun `test paid model auth error enters login required state`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))

        assertTrue(m.model.state is SessionState.LoginRequired)
        assertTrue(appRpc.telemetry.any {
            it.event == "Account Overlay Shown" && it.properties["reason"] == "paid_model_auth"
        })
        assertSession(
            """
            [code] [kilo/gpt-5] [login-required] [Go to User Profile settings to sign in, then continue this session.]
            """,
            m,
        )
    }

    fun `test paid model auth error opens empty new session`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller()
        flush()
        edt { m.prompt("go") }
        flush()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))

        assertSession(
            """
            [code] [kilo/gpt-5] [login-required] [Go to User Profile settings to sign in, then continue this session.]
            """,
            m,
        )
    }

    fun `test normal api error remains generic error`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"SOME_OTHER_CODE"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Bad Request", statusCode = 400, responseBody = body),
        ))

        assertTrue(m.model.state is SessionState.Error)
        assertSession(
            """
            [code] [kilo/gpt-5] [error] [Bad Request]
            """,
            m,
        )
    }

    fun `test login clears paid model gate`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        assertTrue(m.model.state is SessionState.LoginRequired)

        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "kilo/gpt-5"),
            profile = ProfileDto(email = "user@example.com"),
        )
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
        assertTrue(m.model.showSession)
    }

    fun `test login resumes paid model prompt`() {
        val (m, _, _) = prompted()
        val msg = MessageDto(
            id = "msg_user",
            sessionID = "ses_test",
            role = "user",
            time = MessageTimeDto(created = 0.0),
            agent = "code",
            providerID = "kilo/openai",
            modelID = "gpt-5.5",
        )
        emit(ChatEventDto.MessageUpdated("ses_test", msg))
        emit(ChatEventDto.PartUpdated(
            "ses_test",
            PartDto("prt_user", "ses_test", "msg_user", "text", text = "try again"),
        ))
        rpc.prompts.clear()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "kilo/gpt-5"),
            profile = ProfileDto(email = "user@example.com"),
        )
        flush()

        assertEquals(1, rpc.prompts.size)
        val prompt = rpc.prompts.single().third
        assertEquals("msg_user", prompt.messageID)
        assertEquals(false, prompt.noReply)
        assertEquals("code", prompt.agent)
        assertEquals("kilo/openai", prompt.providerID)
        assertEquals("gpt-5.5", prompt.modelID)
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test session idle does not clobber login required`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        emit(ChatEventDto.SessionIdle("ses_test"))

        assertTrue(m.model.state is SessionState.LoginRequired)
    }

    fun `test session status idle does not clobber login required`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        emit(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("idle")))

        assertTrue(m.model.state is SessionState.LoginRequired)
    }

    fun `test turn close error does not clobber login required`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        emit(ChatEventDto.TurnClose("ses_test", "error"))

        assertTrue(m.model.state is SessionState.LoginRequired)
    }

    fun `test dismissLoginRequired transitions state to idle`() {
        val (m, _, _) = prompted()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        assertTrue(m.model.state is SessionState.LoginRequired)

        edt { m.dismissLoginRequired() }
        flush()

        assertTrue(appRpc.telemetry.any {
            it.event == "Account Overlay Dismissed" && it.properties["reason"] == "paid_model_auth"
        })
        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test dismissLoginRequired clears retry so login does not resume prompt`() {
        val (m, _, _) = prompted()
        val msg = MessageDto(
            id = "msg_user",
            sessionID = "ses_test",
            role = "user",
            time = MessageTimeDto(created = 0.0),
            agent = "code",
            providerID = "kilo/openai",
            modelID = "gpt-5.5",
        )
        emit(ChatEventDto.MessageUpdated("ses_test", msg))
        rpc.prompts.clear()

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error(
            "ses_test",
            MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body),
        ))
        assertTrue(m.model.state is SessionState.LoginRequired)

        edt { m.dismissLoginRequired() }
        flush()

        // profile becomes available, but there should be no auto-retry
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "kilo/gpt-5"),
            profile = ProfileDto(email = "user@example.com"),
        )
        flush()

        assertEquals("retry should not have fired after dismiss", 0, rpc.prompts.size)
        assertTrue("state should be idle after dismiss + profile available", m.model.state is SessionState.Idle)
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
