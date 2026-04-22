package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionTimeDto

/**
 * Tests for pending permission/question recovery after history load.
 *
 * VS Code rehydrates pending prompts by calling list endpoints after
 * reconnect. JetBrains now does the same in [SessionController.recoverPending].
 */
class SessionRecoveryTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        // Set a pre-existing session in the fake API
        rpc.session = rpc.session.copy(id = "ses_test")
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // State should remain Idle — other session's pending is irrelevant
        assertEquals(SessionState.Idle, m.model.state)
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        // Permission list non-empty → AwaitingPermission wins
        assertTrue(m.model.state is SessionState.AwaitingPermission)
    }

    // ------ Status seeding from KiloSessionService.statuses ------

    fun `test busy status is seeded from statuses map`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m, show = false,
        )
    }

    fun `test retry status is seeded with message attempt and next`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto(
            type = "retry",
            message = "Rate limited",
            attempt = 3,
            next = 5000L,
        ))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [retry] [Rate limited]
            """,
            m, show = false,
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test")
        flush()

        assertSession(
            """
            [code] [kilo/gpt-5] [offline] [No network]
            """,
            m, show = false,
        )
        assertEquals("req_xyz", (m.model.state as SessionState.Offline).requestId)
    }

    fun `test idle status in map leaves controller in Idle`() {
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("idle"))

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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
            m, show = false,
        )
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

        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
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
            m, show = false,
        )
    }
}
