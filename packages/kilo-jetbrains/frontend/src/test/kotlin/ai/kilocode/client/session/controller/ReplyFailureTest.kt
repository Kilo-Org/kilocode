package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.QuestionRequestState
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
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
