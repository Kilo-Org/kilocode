package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.testing.FakeSessionRpcApi
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
import ai.kilocode.rpc.dto.SessionRevertDto
import ai.kilocode.rpc.dto.SessionStatusDto
import kotlinx.coroutines.CompletableDeferred

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

    fun `test revert aborts busy session before rollback`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.TurnOpen("ses_test"))

        edt { m.revert("msg1") }
        flush()

        assertEquals(listOf("ses_test" to "/test"), rpc.aborts)
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "msg1", null)), rpc.reverts)
    }

    fun `test session updated applies rollback marker`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("msg1"))))

        assertEquals("msg1", m.model.revert()?.messageID)
        assertTrue(modelEvents.any { it.toString() == "RevertChanged msg1" })
    }

    fun `test redo reverts to next user message`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("u1"))))
        rpc.reverts.clear()

        edt { m.redo() }
        flush()

        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "u2", null)), rpc.reverts)
        assertTrue(appRpc.telemetry.any { it.event == "Session Redo" })
    }

    fun `test redo aborts busy session before partial redo`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("u1"))))
        emit(ChatEventDto.TurnOpen("ses_test"))

        edt { m.redo() }
        flush()

        assertEquals(listOf("ses_test" to "/test"), rpc.aborts)
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "u2", null)), rpc.reverts)
    }

    fun `test redo at final user message unreverts`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("u2"))))
        rpc.reverts.clear()

        edt { m.redo() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertEquals(listOf("ses_test" to "/test"), rpc.unreverts)
        assertTrue(appRpc.telemetry.any { it.event == "Session Redo" })
    }

    fun `test redo unreverts stale rollback marker`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("missing"))))
        rpc.reverts.clear()
        rpc.unreverts.clear()

        edt { m.redo() }
        flush()

        assertTrue(rpc.reverts.isEmpty())
        assertEquals(listOf("ses_test" to "/test"), rpc.unreverts)
        assertTrue(appRpc.telemetry.any { it.event == "Session Redo" })
    }

    fun `test redoAll calls unrevert`() {
        val (m, _, _) = prompted()

        edt { m.redoAll() }
        flush()

        assertEquals(listOf("ses_test" to "/test"), rpc.unreverts)
        assertTrue(appRpc.telemetry.any { it.event == "Session Redo All" })
    }

    fun `test unrevert clears through rpc`() {
        val (m, _, _) = prompted()

        edt { m.unrevert() }
        flush()

        assertEquals(listOf("ses_test" to "/test"), rpc.unreverts)
        assertTrue(appRpc.telemetry.any { it.event == "Session Unrevert" })
    }

    fun `test rollback round trip hides and restores reverted messages`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        rpc.reverts.clear()

        edt { m.revert("u1") }
        flush()
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "u1", null)), rpc.reverts)

        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("u1", snapshot = "snap1"))))
        assertTrue(m.model.isRevertedMessage("u1"))
        assertTrue(m.model.isRevertedMessage("u2"))

        edt { m.redoAll() }
        flush()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = null)))

        assertNull(m.model.revert())
        assertFalse(m.model.isRevertedMessage("u1"))
        assertFalse(m.model.isRevertedMessage("u2"))
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


    fun `test rollback click enters reverting state before rpc resolves`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()

        val state = m.model.state
        assertTrue("expected Reverting, was $state", state is SessionState.Reverting)
        assertEquals(KiloBundle.message("session.status.rollingback"), (state as SessionState.Reverting).text)

        gate.complete(Unit)
        flush()

        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "msg1", null)), rpc.reverts)
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test reverting state renders in dump`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()

        assertSession(
            """
            [code] [kilo/gpt-5] [reverting] [rolling back]
            """,
            m,
        )

        gate.complete(Unit)
        flush()
    }

    fun `test session idle does not clobber reverting state`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        emit(ChatEventDto.SessionIdle("ses_test"))
        assertTrue("idle must not clear reverting", m.model.state is SessionState.Reverting)

        emit(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("idle")))
        assertTrue("status idle must not clear reverting", m.model.state is SessionState.Reverting)

        emit(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("retry", message = "retrying", attempt = 1, next = 0L)))
        assertTrue("status retry must not clear reverting", m.model.state is SessionState.Reverting)

        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue("turn open must not clear reverting", m.model.state is SessionState.Reverting)

        emit(ChatEventDto.TurnClose("ses_test", reason = "completed"))
        assertTrue("turn close must not clear reverting", m.model.state is SessionState.Reverting)

        gate.complete(Unit)
        flush()
    }

    fun `test revert reconciles active turn deferred during rollback`() {
        val (m, _, _) = prompted()
        // Land on idle so the rollback does not abort, then start a gated rollback.
        emit(ChatEventDto.TurnClose("ses_test", reason = "completed"))
        assertTrue(m.model.state is SessionState.Idle)

        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate
        edt { m.revert("msg1") }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        // A server turn opens while the rollback is in flight; the transition is deferred, not dropped.
        emit(ChatEventDto.TurnOpen("ses_test"))
        assertTrue("turn open must not clear reverting", m.model.state is SessionState.Reverting)

        gate.complete(Unit)
        flush()

        // Releasing the revert restores the still-active turn instead of forcing an idle prompt.
        assertTrue("expected Busy, was ${m.model.state}", m.model.state is SessionState.Busy)
    }

    fun `test rollback while busy enters reverting and aborts`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.TurnOpen("ses_test"))
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        val state = m.model.state
        assertTrue(state is SessionState.Reverting)
        assertEquals(SessionState.Reverting.Kind.ROLLBACK, (state as SessionState.Reverting).kind)
        assertEquals("msg1", state.message)

        gate.complete(Unit)
        flush()

        assertEquals(listOf("ses_test" to "/test"), rpc.aborts)
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "msg1", null)), rpc.reverts)
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test revert failure surfaces error state`() {
        val (m, _, _) = prompted()
        rpc.revertThrows = IllegalStateException("boom")

        edt { m.revert("msg1") }
        flush()

        val state = m.model.state
        assertTrue("expected Error, was $state", state is SessionState.Error)
        assertEquals("boom", (state as SessionState.Error).message)
    }

    fun `test rollback ignores reentrant click while reverting`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        edt { m.revert("msg2") }
        settle()

        gate.complete(Unit)
        flush()

        assertEquals(1, rpc.reverts.size)
    }

    fun `test redo enters reverting with redoing status`() {
        val (m, _, _) = prompted()
        seedRevertMessages()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test").copy(revert = SessionRevertDto("u1"))))
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.redo() }
        settle()

        val state = m.model.state
        assertTrue("expected Reverting, was $state", state is SessionState.Reverting)
        assertEquals(KiloBundle.message("session.status.redoing"), (state as SessionState.Reverting).text)
        assertEquals(SessionState.Reverting.Kind.REDO, state.kind)

        gate.complete(Unit)
        flush()
    }

    fun `test redoAll enters reverting with redoing status`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.unrevertGate = gate

        edt { m.redoAll() }
        settle()

        val state = m.model.state
        assertTrue("expected Reverting, was $state", state is SessionState.Reverting)
        assertEquals(KiloBundle.message("session.status.redoing"), (state as SessionState.Reverting).text)
        assertEquals(SessionState.Reverting.Kind.REDO, state.kind)

        gate.complete(Unit)
        flush()
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test unrevert failure surfaces error state`() {
        val (m, _, _) = prompted()
        rpc.unrevertThrows = IllegalStateException("nope")

        edt { m.unrevert() }
        flush()

        val state = m.model.state
        assertTrue("expected Error, was $state", state is SessionState.Error)
        assertEquals("nope", (state as SessionState.Error).message)
    }


    fun `test cancelRevert cancels in-flight rollback and returns to idle`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        edt { m.cancelRevert() }
        settle()

        assertTrue(m.model.state is SessionState.Idle)
        assertTrue("rpc must still be waiting", rpc.reverts.isEmpty())
        assertTrue(appRpc.telemetry.any { it.event == "Session Revert Cancel Requested" })

        gate.complete(Unit)
        flush()
        assertTrue(rpc.reverts.isEmpty())
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test cancelRevert cancels in-flight redoAll`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.unrevertGate = gate

        edt { m.redoAll() }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        edt { m.cancelRevert() }
        settle()

        assertTrue(m.model.state is SessionState.Idle)
        assertTrue(rpc.unreverts.isEmpty())

        gate.complete(Unit)
        flush()
        assertTrue(rpc.unreverts.isEmpty())
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test cancelRevert is ignored when not reverting`() {
        val (m, _, _) = prompted()

        edt { m.cancelRevert() }
        settle()

        assertTrue(m.model.state is SessionState.Idle)
        assertFalse(appRpc.telemetry.any { it.event == "Session Revert Cancel Requested" })
    }

    fun `test abort while reverting cancels rollback instead of aborting turn`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        edt { m.abort() }
        settle()

        assertTrue(m.model.state is SessionState.Idle)
        assertTrue(rpc.aborts.isEmpty())
        assertTrue(rpc.reverts.isEmpty())

        gate.complete(Unit)
        flush()
        assertTrue(rpc.reverts.isEmpty())
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test rollback watchdog cancels timed out rollback and releases lock`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        assertTrue(m.model.state is SessionState.Reverting)

        pause(SessionController.REVERT_TIMEOUT_MS + 1)

        val state = m.model.state
        assertTrue("expected Error, was $state", state is SessionState.Error)
        assertEquals(KiloBundle.message("session.error.revert.timeout"), (state as SessionState.Error).message)
        assertTrue(appRpc.telemetry.any { it.event == "Session Revert Timeout" })

        gate.complete(Unit)
        edt { m.revert("msg2") }
        settle()
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "msg2", null)), rpc.reverts)

        flush()
        assertEquals(listOf(FakeSessionRpcApi.RevertCall("ses_test", "/test", "msg2", null)), rpc.reverts)
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test successful rollback stops watchdog`() {
        val (m, _, _) = prompted()
        val gate = CompletableDeferred<Unit>()
        rpc.revertGate = gate

        edt { m.revert("msg1") }
        settle()
        gate.complete(Unit)
        flush()
        assertTrue(m.model.state is SessionState.Idle)

        pause(SessionController.REVERT_TIMEOUT_MS + 1)

        assertTrue(m.model.state is SessionState.Idle)
    }

    private fun seedRevertMessages() {
        emit(ChatEventDto.MessageUpdated("ses_test", msg("u1", "ses_test", "user")), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("a1", "ses_test", "assistant")), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("u2", "ses_test", "user")), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("a2", "ses_test", "assistant")))
    }
}
