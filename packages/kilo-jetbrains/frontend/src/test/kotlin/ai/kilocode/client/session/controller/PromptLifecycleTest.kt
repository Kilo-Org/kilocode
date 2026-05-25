package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionFileDiffDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.ToolRefDto
import com.intellij.ide.util.PropertiesComponent

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

    fun `test PermissionAsked maps rich fields to meta`() {
        val (m, _, _) = prompted()
        val req = PermissionRequestDto(
            id = "perm_rich",
            sessionID = "ses_test",
            permission = "edit",
            patterns = listOf("*.kt"),
            always = emptyList(),
            command = "git diff",
            fileDiffs = listOf(PermissionFileDiffDto("src/A.kt", patch = "@@ @@", additions = 1, deletions = 0)),
        )

        emit(ChatEventDto.PermissionAsked("ses_test", req))

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("git diff", perm.meta.command)
        assertEquals(1, perm.meta.fileDiffs.size)
        assertEquals("src/A.kt", perm.meta.fileDiffs[0].file)
    }

    fun `test replyPermission without rules leaves rulesSaved empty`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        edt { m.replyPermission("perm1", PermissionReplyDto("once")) }
        flush()

        assertTrue(rpc.permissionRulesSaved.isEmpty())
        assertEquals(1, rpc.permissionReplies.size)
    }

    // ------ Child session (subagent) permission bubbling ------

    fun `test task part with child sessionId causes controller to track child`() {
        val (m, _, _) = prompted()

        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("child_perm1")))

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("child_perm1", perm.id)
        assertEquals("ses_child", perm.sessionId)
    }

    fun `test child PermissionAsked moves root model to AwaitingPermission`() {
        val (m, _, _) = prompted()

        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("child_perm1")))

        assertSession(
            """
            permission#child_perm1
            tool: <none>
            name: edit
            patterns: *.kt
            always: <none>
            file: <none>
            state: PENDING
            metadata: <none>

            [code] [kilo/gpt-5] [awaiting-permission]
            """,
            m,
        )
    }

    fun `test child PermissionReplied clears root awaiting permission`() {
        val (m, _, _) = prompted()

        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("child_perm1")), flush = false)
        emit(ChatEventDto.PermissionReplied("ses_child", "child_perm1"))

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test replyPermission for child request sends correct requestId`() {
        val (m, _, _) = prompted()

        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("child_perm1")))

        edt { m.replyPermission("child_perm1", PermissionReplyDto("once")) }
        flush()

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("child_perm1", rpc.permissionReplies[0].first)
        assertEquals("once", rpc.permissionReplies[0].third.reply)
    }

    fun `test child non-permission events do not change root state`() {
        val (m, _, modelEvents) = prompted()
        val initialState = m.model.state

        // Emit non-permission child events — they must not affect the root
        emit(ChatEventDto.TurnOpen("ses_child"), flush = false)
        emit(ChatEventDto.SessionStatusChanged("ses_child", ai.kilocode.rpc.dto.SessionStatusDto("busy")), flush = false)
        emit(ChatEventDto.SessionIdle("ses_child"))

        assertEquals(initialState, m.model.state)
        // No extra model state events from child non-permission events
        val stateEvents = modelEvents.filterIsInstance<ai.kilocode.client.session.model.SessionModelEvent.StateChanged>()
        assertTrue("Root state must not be changed by child non-permission events", stateEvents.isEmpty())
    }

    fun `test root permission event is not processed as child permission`() {
        val (m, _, _) = prompted()

        // No task part emitted — root permission should still work
        emit(ChatEventDto.PermissionAsked("ses_test", permission("root_perm")))

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("root_perm", perm.id)
    }

    private fun taskPart(childSessionId: String) = ChatEventDto.PartUpdated(
        sessionID = "ses_test",
        part = PartDto(
            id = "part_task",
            sessionID = "ses_test",
            messageID = "msg1",
            type = "tool",
            tool = "task",
            metadata = mapOf("sessionId" to childSessionId),
        ),
    )

    private fun childPermission(id: String) = PermissionRequestDto(
        id = id,
        sessionID = "ses_child",
        permission = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
    )

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
