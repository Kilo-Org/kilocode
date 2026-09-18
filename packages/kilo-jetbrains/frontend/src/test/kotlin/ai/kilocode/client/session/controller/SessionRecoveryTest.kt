package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto

/**
 * Tests for pending permission/question recovery after history load.
 *
 * VS Code rehydrates pending prompts by calling list endpoints after
 * reconnect. JetBrains now does the same in [ai.kilocode.client.session.controller.SessionController.recoverPending].
 */
class SessionRecoveryTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        // Set a pre-existing session in the fake API
        rpc.session = rpc.session.copy(id = "ses_test")
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
    }

    fun `test pending permission is recovered on history load`() {
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "perm_pending",
                sessionID = "ses_test",
                permission = "read",
                patterns = listOf("*.json"),
            )
        )

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("perm_pending", perm.id)
        assertEquals("read", perm.name)
    }

    fun `test pending question is recovered when no pending permissions`() {
        rpc.pendingQuestionList.add(
            QuestionRequestDto(
                id = "q_pending",
                sessionID = "ses_test",
                questions = listOf(QuestionInfoDto("What?", "Q")),
            )
        )

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.AwaitingQuestion)
        val q = (m.model.state as SessionState.AwaitingQuestion).question
        assertEquals("q_pending", q.id)
    }

    fun `test pending from other session is ignored`() {
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "perm_other",
                sessionID = "ses_other",  // different session
                permission = "read",
                patterns = emptyList(),
            )
        )

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // State should remain Idle — other session's pending is irrelevant
        assertEquals(SessionState.Idle, m.model.state)
    }

    fun `test provider error is recovered from assistant history`() {
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(error = MessageErrorDto(type = "APIError", message = "OpenRouter balance is too low")),
            emptyList(),
        ))

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            assistant#msg1

            [code] [kilo/gpt-5] [error] [OpenRouter balance is too low]
            """,
            m,
        )
    }

    fun `test aborted assistant history recovers interrupted outcome`() {
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(error = MessageErrorDto(type = "MessageAbortedError", message = "aborted")),
            emptyList(),
        ))

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            assistant#msg1

            [code] [kilo/gpt-5] [interrupted]
            """,
            m,
        )
    }

    fun `test permission takes priority over question in recovery`() {
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "perm_pending",
                sessionID = "ses_test",
                permission = "edit",
                patterns = emptyList(),
            )
        )
        rpc.pendingQuestionList.add(
            QuestionRequestDto(
                id = "q_pending",
                sessionID = "ses_test",
                questions = listOf(QuestionInfoDto("What?", "Q")),
            )
        )

        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // Permission list non-empty → AwaitingPermission wins
        assertTrue(m.model.state is SessionState.AwaitingPermission)
    }

    // ------ Status seeding from KiloSessionService.statuses ------

    fun `test busy status is seeded from statuses map`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        // recoverPending() reads the service's status map once, and that map arrives through a flow, so
        // the seed has to be observable before the controller loads or recovery races it to Idle.
        assertTrue(waitFor { sessions.statuses.value["ses_test"]?.type == "busy" })

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m, show = true,
        )
    }

    fun `test retry status is seeded with message attempt and next`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto(
            type = "retry",
            message = "Rate limited",
            attempt = 3,
            next = 5000L,
        ))
        assertTrue(waitFor { sessions.statuses.value["ses_test"]?.type == "retry" })

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [retry] [Rate limited]
            """,
            m, show = true,
        )
        val state = m.model.state as SessionState.Retry
        assertEquals(3, state.attempt)
        assertEquals(5000L, state.next)
    }

    fun `test offline status is seeded with message and requestId`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto(
            type = "offline",
            message = "No network",
            requestID = "req_xyz",
        ))
        assertTrue(waitFor { sessions.statuses.value["ses_test"]?.type == "offline" })

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [offline] [No network]
            """,
            m, show = true,
        )
        assertEquals("req_xyz", (m.model.state as SessionState.Offline).requestId)
    }

    /**
     * A session reopened after a failed turn is idle on the server, so recovery has to fall back to the
     * transcript. Without it the reopened UI shows the failure with no way to act on it, while the UI
     * that was open when it failed still offers Retry.
     */
    fun `test failed tail recovers into error even when the server reports idle`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))
        rpc.history.add(MessageWithPartsDto(
            msg("msg2", "ses_test", "assistant").copy(
                parentID = "msg1",
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue("Recovery must not drop the failure", state is SessionState.Error)
        assertEquals("missing credentials", (state as SessionState.Error).message)
        edt { assertTrue("The reopened session must offer Retry too", m.canRetry()) }
    }

    fun `test aborted tail recovers as interrupted even when the server reports idle`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                error = MessageErrorDto(type = MessageErrorDto.ABORTED, message = "aborted"),
            ),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue(state is SessionState.TurnEnded)
        assertEquals(
            ai.kilocode.client.session.model.Outcome.INTERRUPTED,
            (state as SessionState.TurnEnded).outcome,
        )
    }

    fun `test incomplete tail recovers even when the server reports idle`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(finish = "unknown"),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue(state is SessionState.TurnEnded)
        assertEquals(
            ai.kilocode.client.session.model.Outcome.INCOMPLETE,
            (state as SessionState.TurnEnded).outcome,
        )
        assertEquals("unknown", state.finish)
    }

    fun `test normal finish does not recover an outcome`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(finish = "stop"),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertEquals(SessionState.Idle, m.model.state)
    }

    fun `test tail error wins over incomplete finish during recovery`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                finish = "unknown",
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue(state is SessionState.Error)
        assertEquals("missing credentials", (state as SessionState.Error).message)
    }

    /** An unrecognised status carries no live work either, so the transcript still decides. */
    fun `test unknown status falls through to the failed tail`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("something-new"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue(state is SessionState.Error)
        assertEquals("missing credentials", (state as SessionState.Error).message)
    }

    /** A tail that failed does not outrank a question the server is still waiting on. */
    fun `test pending question wins over a failed tail`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))
        rpc.pendingQuestionList.add(
            QuestionRequestDto(
                id = "q_pending",
                sessionID = "ses_test",
                questions = listOf(QuestionInfoDto("Proceed?", "Q")),
            )
        )
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.AwaitingQuestion)
    }

    fun `test retry status wins over a failed tail`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("retry", "Rate limited", attempt = 2, next = 1000L))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))
        assertTrue(waitFor { sessions.statuses.value["ses_test"]?.type == "retry" })

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        val state = m.model.state
        assertTrue("The CLI is still retrying, so that outranks the tail", state is SessionState.Retry)
        assertEquals(2, (state as SessionState.Retry).attempt)
    }

    /** Live work still wins: a busy server must not be overridden by an older failed turn. */
    fun `test busy status wins over a failed tail`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        rpc.history.add(MessageWithPartsDto(
            msg("msg1", "ses_test", "assistant").copy(
                error = MessageErrorDto(type = "APIError", message = "missing credentials"),
            ),
            emptyList(),
        ))
        assertTrue(waitFor { sessions.statuses.value["ses_test"]?.type == "busy" })

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test idle status in map leaves controller in Idle`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m, show = false,
        )
    }

    fun `test missing status entry leaves controller in Idle`() {
        rpc.statuses.value = emptyMap()

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m, show = false,
        )
    }

    fun `test pending permission overrides a seeded busy status`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "perm_p",
                sessionID = "ses_test",
                permission = "read",
                patterns = listOf("*.kt"),
            )
        )

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            permission#perm_p
            tool: <none>
            name: read
            patterns: *.kt
            always: <none>
            file: <none>
            state: PENDING
            metadata: <none>

            [code] [kilo/gpt-5] [awaiting-permission]
            """,
            m, show = true,
        )
    }

    // ------ Child session permission recovery from history ------

    fun `test history with task part and pending child permission recovers to AwaitingPermission`() {
        rpc.history.add(
            MessageWithPartsDto(
                info = msg("msg1", "ses_test", "assistant"),
                parts = listOf(
                    PartDto(
                        id = "part_task",
                        sessionID = "ses_test",
                        messageID = "msg1",
                        type = "tool",
                        tool = "task",
                        metadata = mapOf("sessionId" to "ses_child"),
                    ),
                ),
            )
        )
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "child_perm_1",
                sessionID = "ses_child",
                permission = "read",
                patterns = listOf("*.json"),
            )
        )

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("child_perm_1", perm.id)
        assertEquals("ses_child", perm.sessionId)
    }

    fun `test pending child permission from unrelated session is ignored`() {
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "perm_unrelated",
                sessionID = "ses_other_child",
                permission = "read",
                patterns = emptyList(),
            )
        )

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // No task part linking ses_other_child — its permissions must be ignored
        assertEquals(SessionState.Idle, m.model.state)
    }

    fun `test root pending permission takes priority over child pending permission`() {
        rpc.history.add(
            MessageWithPartsDto(
                info = msg("msg1", "ses_test", "assistant"),
                parts = listOf(
                    PartDto(
                        id = "part_task",
                        sessionID = "ses_test",
                        messageID = "msg1",
                        type = "tool",
                        tool = "task",
                        metadata = mapOf("sessionId" to "ses_child"),
                    ),
                ),
            )
        )
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "root_perm",
                sessionID = "ses_test",
                permission = "edit",
                patterns = listOf("*.kt"),
            )
        )
        rpc.pendingPermissionList.add(
            PermissionRequestDto(
                id = "child_perm",
                sessionID = "ses_child",
                permission = "read",
                patterns = listOf("*.json"),
            )
        )

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // Root recovery runs first and sets AwaitingPermission for root perm
        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("root_perm", perm.id)
    }

    fun `test pending question overrides a seeded retry status`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("retry", "Rate limited", attempt = 1, next = 1000L))
        rpc.pendingQuestionList.add(
            QuestionRequestDto(
                id = "q_p",
                sessionID = "ses_test",
                questions = listOf(QuestionInfoDto("Proceed?", "Q")),
            )
        )

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            question#q_p
            tool: <none>
            header: Q
            prompt: Proceed?
            multiple: false
            custom: true

            [code] [kilo/gpt-5] [awaiting-question]
            """,
            m, show = true,
        )
    }
}
