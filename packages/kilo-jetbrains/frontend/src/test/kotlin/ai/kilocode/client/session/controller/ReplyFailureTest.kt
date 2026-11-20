package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.QuestionRequestState
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto

/** A decision the local server refuses must stay visible: the card reports it and remains answerable. */
class ReplyFailureTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        // A leftover auto-approve would answer the permission in the test's place and never show a card.
        edt { KiloPluginSettings.unsetAutoApprove() }
    }

    override fun tearDown() {
        try {
            // Auto-approve is application-level: never leave it on for the next test in this fixture.
            edt { KiloPluginSettings.unsetAutoApprove() }
        } finally {
            super.tearDown()
        }
    }

    fun `test refused permission reply leaves an error card`() {
        rpc.replyPermissionThrows = RuntimeException("refused")
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        edt { m.replyPermission("perm1", PermissionReplyDto("once")) }
        flush()

        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected AwaitingPermission")
        assertEquals("perm1", state.permission.id)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)
        assertEquals("refused", state.permission.message)
    }

    fun `test refused always rules save leaves an error card and sends no reply`() {
        rpc.permissionRulesThrows = RuntimeException("denied")
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        edt {
            m.replyPermission(
                "perm1",
                PermissionReplyDto("always"),
                PermissionAlwaysRulesDto(approvedAlways = listOf("*.kt")),
            )
        }
        flush()

        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected AwaitingPermission")
        assertEquals("perm1", state.permission.id)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)
        assertEquals("denied", state.permission.message)
        assertTrue(rpc.permissionReplies.isEmpty())
    }

    fun `test refused question reply leaves an error question`() {
        rpc.replyQuestionThrows = RuntimeException("refused")
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("A")))) }
        flush()

        val state = m.model.state as? SessionState.AwaitingQuestion ?: error("Expected AwaitingQuestion")
        assertEquals("q1", state.question.id)
        assertEquals(QuestionRequestState.ERROR, state.question.state)
        assertEquals("refused", state.question.message)
        assertTrue(rpc.questionReplies.isEmpty())
    }

    fun `test refused question reject leaves an error question`() {
        rpc.rejectQuestionThrows = RuntimeException("refused")
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.rejectQuestion("q1") }
        flush()

        val state = m.model.state as? SessionState.AwaitingQuestion ?: error("Expected AwaitingQuestion")
        assertEquals("q1", state.question.id)
        assertEquals(QuestionRequestState.ERROR, state.question.state)
        assertEquals("refused", state.question.message)
        assertTrue(rpc.questionRejects.isEmpty())
    }

    fun `test submitted question waits on the service before it resolves`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("A")))) }
        flush()

        val state = m.model.state as? SessionState.AwaitingQuestion ?: error("Expected AwaitingQuestion")
        assertEquals("q1", state.question.id)
        assertEquals(QuestionRequestState.RESPONDING, state.question.state)
        assertEquals(1, rpc.questionReplies.size)
    }

    fun `test rejected question waits on the service before it resolves`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.rejectQuestion("q1") }
        flush()

        val state = m.model.state as? SessionState.AwaitingQuestion ?: error("Expected AwaitingQuestion")
        assertEquals("q1", state.question.id)
        assertEquals(QuestionRequestState.RESPONDING, state.question.state)
        assertEquals(1, rpc.questionRejects.size)
    }

    fun `test refused auto approval does not abort the rest of the drain`() {
        val (m, _, _) = prompted()
        rpc.pendingPermissionList.add(permission("perm1"))
        rpc.pendingPermissionList.add(permission("perm2"))
        rpc.replyPermissionThrows = RuntimeException("refused")
        rpc.replyPermissionThrowsFor = setOf("perm1")

        edt { m.setAutoApprove(true) }
        flush()

        assertEquals(listOf("perm1", "perm2"), rpc.permissionReplyAttempts)
        assertEquals(listOf("perm2"), rpc.permissionReplies.map { it.first })
    }

    fun `test refused drain reply leaves an error card for that request only`() {
        val (m, _, _) = prompted()
        rpc.pendingPermissionList.add(permission("perm1"))
        rpc.pendingPermissionList.add(permission("perm2"))
        rpc.replyPermissionThrows = RuntimeException("refused")
        rpc.replyPermissionThrowsFor = setOf("perm1")

        edt { m.setAutoApprove(true) }
        flush()

        // The refused request still reports its failure on a card, while the approved one has none.
        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected an error card")
        assertEquals("perm1", state.permission.id)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)
        assertEquals("refused", state.permission.message)

        // Resolving the error card leaves perm2 already approved, so nothing else is queued.
        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test refused auto approval during recovery leaves an error card`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        rpc.pendingPermissionList.add(permission("perm1"))
        rpc.pendingPermissionList.add(permission("perm2"))
        rpc.replyPermissionThrows = RuntimeException("refused")
        rpc.replyPermissionThrowsFor = setOf("perm1")
        edt { KiloPluginSettings.setAutoApprove(true) }

        val m = controller("ses_test")
        flush()

        assertEquals(listOf("perm1", "perm2"), rpc.permissionReplyAttempts)
        assertEquals(listOf("perm2"), rpc.permissionReplies.map { it.first })
        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected an error card")
        assertEquals("perm1", state.permission.id)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)
        assertEquals("refused", state.permission.message)
    }

    fun `test refused child auto approval during recovery leaves an error card`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
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
        rpc.pendingPermissionList.add(permission("child_perm1").copy(sessionID = "ses_child"))
        rpc.pendingPermissionList.add(permission("child_perm2").copy(sessionID = "ses_child"))
        rpc.replyPermissionThrows = RuntimeException("refused")
        rpc.replyPermissionThrowsFor = setOf("child_perm1")
        edt { KiloPluginSettings.setAutoApprove(true) }

        val m = controller("ses_test")
        flush()

        assertEquals(listOf("child_perm1", "child_perm2"), rpc.permissionReplyAttempts)
        assertEquals(listOf("child_perm2"), rpc.permissionReplies.map { it.first })
        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected an error card")
        assertEquals("child_perm1", state.permission.id)
        assertEquals("ses_child", state.permission.sessionId)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)
        assertEquals("refused", state.permission.message)
    }

    private fun permission(id: String) = PermissionRequestDto(
        id = id,
        sessionID = "ses_test",
        permission = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
    )

    private fun question(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(QuestionInfoDto("Pick one", "Choice")),
    )
}
