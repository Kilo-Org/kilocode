package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.ToolRefDto

class PromptLifecycleTest : SessionControllerTestBase() {

    fun `test PermissionAsked moves state to AwaitingPermission`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        assertSession(
            """
            permission#perm1
            tool: msg1/call1
            name: edit
            patterns: *.kt
            always: <none>
            file: src/A.kt
            state: RESPONDING
            metadata: kind=edit

            [code] [kilo/gpt-5] [awaiting-permission]
            """,
            m,
        )
    }

    fun `test PermissionReplied resumes Busy state`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test QuestionAsked moves state to AwaitingQuestion`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        assertSession(
            """
            question#q1
            tool: msg1/call1
            header: Choice
            prompt: Pick one
            option: A - Option A
            multiple: false
            custom: true

            [code] [kilo/gpt-5] [awaiting-question]
            """,
            m,
        )
    }

    fun `test QuestionReplied resumes Busy state`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.QuestionReplied("ses_test", "q1"))

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test QuestionRejected moves state to Idle`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.QuestionRejected("ses_test", "q1"))

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test PermissionReplied with wrong requestID is ignored`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        emit(ChatEventDto.PermissionReplied("ses_test", "wrong_id"))

        // State must remain AwaitingPermission
        assertTrue(m.model.state is SessionState.AwaitingPermission)
    }

    fun `test QuestionReplied with wrong requestID is ignored`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.QuestionReplied("ses_test", "wrong_id"))

        // State must remain AwaitingQuestion
        assertTrue(m.model.state is SessionState.AwaitingQuestion)
    }

    fun `test QuestionRejected with wrong requestID is ignored`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.QuestionRejected("ses_test", "wrong_id"))

        // State must remain AwaitingQuestion
        assertTrue(m.model.state is SessionState.AwaitingQuestion)
    }

    fun `test replyPermission calls RPC`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        edt { m.replyPermission("perm1", PermissionReplyDto("once")) }
        flush()

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("perm1", rpc.permissionReplies[0].first)
        assertEquals("once", rpc.permissionReplies[0].third.reply)
    }

    fun `test replyPermission with rules saves always rules first`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        val rules = PermissionAlwaysRulesDto(approvedAlways = listOf("src/**"))
        edt { m.replyPermission("perm1", PermissionReplyDto("always"), rules) }
        flush()

        assertEquals(1, rpc.permissionRulesSaved.size)
        assertEquals("perm1", rpc.permissionRulesSaved[0].first)
        assertEquals(1, rpc.permissionReplies.size)
    }

    fun `test replyQuestion calls RPC`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("A")))) }
        flush()

        assertEquals(1, rpc.questionReplies.size)
        assertEquals("q1", rpc.questionReplies[0].first)
    }

    fun `test rejectQuestion calls RPC`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))

        edt { m.rejectQuestion("q1") }
        flush()

        assertEquals(1, rpc.questionRejects.size)
        assertEquals("q1", rpc.questionRejects[0].first)
    }

    private fun permission(id: String) = PermissionRequestDto(
        id = id,
        sessionID = "ses_test",
        permission = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        metadata = mapOf("kind" to "edit", "file" to "src/A.kt", "state" to "RESPONDING"),
        tool = ToolRefDto("msg1", "call1"),
    )

    private fun question(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Pick one",
                header = "Choice",
                options = listOf(QuestionOptionDto("A", "Option A")),
                multiple = false,
                custom = true,
            ),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )
}
