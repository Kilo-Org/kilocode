package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.model.Tool
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionFileDiffDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.ToolRefDto
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.onCompletion

class PromptLifecycleTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        edt { KiloPluginSettings.unsetAutoApprove() }
    }

    override fun tearDown() {
        try {
            edt { KiloPluginSettings.unsetAutoApprove() }
        } finally {
            super.tearDown()
        }
    }

    fun `test prompt records send intent telemetry`() {
        prompted()

        val event = appRpc.telemetry.single { it.event == "Conversation Send Clicked" }
        assertEquals("user", event.properties["source"])
        assertEquals("false", event.properties["hasExistingSession"])
        assertEquals("short", event.properties["textLength"])
    }

    fun `test prompt records aggregate mention telemetry`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        val m = controller()
        val files = listOf(
            PromptPartDto(
                type = "file",
                mime = "text/plain",
                url = "file:///repo/src/A.kt",
                source = PartSourceDto("file", PartSourceTextDto("@src/A.kt", 0.0, 9.0), path = "src/A.kt"),
            ),
            PromptPartDto(
                type = "file",
                mime = "text/plain",
                url = "file:///repo/src/B.kt",
                source = PartSourceDto("file", PartSourceTextDto("@src/B.kt", 10.0, 19.0), path = "/repo/src/B.kt"),
            ),
            PromptPartDto(
                type = "text",
                text = "diff",
                source = PartSourceDto("resource", PartSourceTextDto("@git-changes", 20.0, 32.0), path = "git-changes"),
            ),
        )

        flush()
        edt { m.prompt("review", files) }
        flush()

        val sent = appRpc.telemetry.single { it.event == "Conversation Send Clicked" }
        assertEquals("true", sent.properties["hasMentions"])
        assertEquals("3", sent.properties["mentionCount"])
        assertEquals("2", sent.properties["fileMentionCount"])
        assertEquals("1", sent.properties["resourceMentionCount"])
        assertFalse(sent.properties.containsValue("@src/A.kt"))
        assertFalse(sent.properties.containsValue("src/A.kt"))
        assertFalse(sent.properties.containsValue("/repo/src/B.kt"))
        val message = appRpc.telemetry.single { it.event == "Conversation Message" }
        assertEquals("true", message.properties["hasMentions"])
        assertEquals("3", message.properties["mentionCount"])
        assertEquals("2", message.properties["fileMentionCount"])
        assertEquals("1", message.properties["resourceMentionCount"])
        assertFalse(message.properties.containsValue("@git-changes"))
        assertFalse(message.properties.containsValue("git-changes"))
    }

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

    fun `test auto approve replies once to permission request`() {
        val (m, _, _) = prompted()

        edt { m.setAutoApprove(true) }
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("perm1", rpc.permissionReplies[0].first)
        assertEquals("once", rpc.permissionReplies[0].third.reply)
        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test disabling auto approve before reply restores awaiting permission`() {
        val (m, _, _) = prompted()

        edt { m.setAutoApprove(true) }
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")), flush = false)
        edt { m.setAutoApprove(false) }
        flush()

        assertTrue(rpc.permissionReplies.isEmpty())
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

    fun `test enabling auto approve drains current permission`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        edt { m.setAutoApprove(true) }
        flush()

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("perm1", rpc.permissionReplies[0].first)
        assertEquals("once", rpc.permissionReplies[0].third.reply)
        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test enabling auto approve drains pending permissions`() {
        val (m, _, _) = prompted()
        rpc.pendingPermissionList.add(permission("perm_pending"))

        edt { m.setAutoApprove(true) }
        flush()

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("perm_pending", rpc.permissionReplies[0].first)
        assertEquals("once", rpc.permissionReplies[0].third.reply)
    }

    fun `test auto approve drains pending permissions during recovery`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        rpc.pendingPermissionList.add(permission("perm_pending"))
        edt { KiloPluginSettings.setAutoApprove(true) }

        val m = controller("ses_test")
        flush()

        assertEquals(1, rpc.permissionReplies.size)
        assertEquals("perm_pending", rpc.permissionReplies[0].first)
        assertFalse(m.model.state is SessionState.AwaitingPermission)
    }

    fun `test auto approve persists in properties`() {
        val (m, _, _) = prompted()

        assertFalse(KiloPluginSettings.getAutoApprove())
        edt { m.setAutoApprove(true) }

        assertTrue(KiloPluginSettings.getAutoApprove())
        assertTrue(m.autoApprove)
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

    fun `test plan follow-up question enters awaiting state`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))

        assertSession(
            """
            question#q_plan
            tool: <none>
            header: Implement
            prompt: Ready to implement?
            option: Start new session - Implement in a fresh session with a clean context
            option: Continue here - Implement the plan in this session
            multiple: false
            custom: true

            [code] [kilo/gpt-5] [awaiting-question]
            """,
            m,
        )
    }

    fun `test continue here reflects CLI mode after canonical reply`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = planWorkspace()
        val m = controller()
        val events = collect(m)
        flush()
        edt { m.prompt("go") }
        flush()
        events.clear()
        edt { m.model.agent = "plan" }
        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))

        edt {
            m.replyQuestion(
                "q_plan",
                QuestionReplyDto(listOf(listOf("Continue here"))),
                listOf(listOf("Continue here")),
            )
        }
        flush()

        assertEquals("plan", m.model.agent)
        assertTrue(rpc.configs.none { it.second.agent == "code" })
        assertQuestionReply("q_plan /test [[Continue here]]", rpc.questionReplies)

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg_code", "ses_test", "user").copy(
            agent = "code",
            providerID = "anthropic",
            modelID = "claude",
        )))

        assertEquals("code", m.model.agent)
        assertEquals("anthropic/claude", m.model.model)
        assertFalse(m.model.modelOverride)
        assertTrue(rpc.configs.none { it.second.agent == "code" })
        assertControllerEvents("WorkspaceReady", events)
    }

    fun `test custom plan follow-up answer does not switch mode`() {
        val (m, _, _) = prompted()
        edt { m.model.agent = "plan" }
        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))

        edt {
            m.replyQuestion(
                "q_plan",
                QuestionReplyDto(listOf(listOf("Need to adjust scope"))),
                listOf(emptyList()),
            )
        }
        flush()

        assertEquals("plan", m.model.agent)
        assertTrue(rpc.configs.none { it.second.agent == "code" })
        assertQuestionReply("q_plan /test [[Need to adjust scope]]", rpc.questionReplies)
    }

    fun `test start new session adopts matching created session from selected option`() {
        val opened = mutableListOf<SessionRef>()
        val m = controller(open = { opened.add(it) })
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        flush()
        edt { m.prompt("go") }
        flush()
        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))

        edt {
            m.replyQuestion(
                "q_plan",
                QuestionReplyDto(listOf(listOf("Use a fresh implementation session"))),
                listOf(listOf("Start new session")),
            )
        }
        emit(ChatEventDto.SessionCreated("ses_new", session("ses_new", dir = "/test")))
        flush()

        assertEquals("ses_new", (opened.last() as SessionRef.Local).id)
        assertEquals(1, rpc.prompts.size)
    }

    fun `test start new session reply text without selected option is ignored`() {
        val opened = mutableListOf<SessionRef>()
        val m = controller(open = { opened.add(it) })
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        flush()
        edt { m.prompt("go") }
        flush()
        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))

        edt {
            m.replyQuestion(
                "q_plan",
                QuestionReplyDto(listOf(listOf("Start new session"))),
                listOf(emptyList()),
            )
        }
        emit(ChatEventDto.SessionCreated("ses_new", session("ses_new", dir = "/test")))

        assertTrue(opened.none { it is SessionRef.Local && it.id == "ses_new" })
    }

    fun `test unrelated session created is ignored`() {
        val opened = mutableListOf<SessionRef>()
        val m = controller(open = { opened.add(it) })
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY, config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        flush()
        edt { m.prompt("go") }
        flush()
        emit(ChatEventDto.QuestionAsked("ses_test", planQuestion("q_plan")))
        edt {
            m.replyQuestion(
                "q_plan",
                QuestionReplyDto(listOf(listOf("Start new session"))),
                listOf(listOf("Start new session")),
            )
        }

        emit(ChatEventDto.SessionCreated("ses_new", session("ses_new", dir = "/other")))

        assertTrue(opened.none { it is SessionRef.Local && it.id == "ses_new" })
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

    fun `test repeated task part subscribes to child once`() {
        val calls = CopyOnWriteArrayList<String>()
        rpc.eventFlow = { id, _ ->
            calls.add(id)
            rpc.events
        }
        prompted()

        emit(taskPart("ses_child"), flush = false)
        emit(taskPart("ses_child"))

        assertEquals(1, calls.count { it == "ses_child" })
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

    fun `test child tool update is stored on parent task part`() {
        val (m, _, modelEvents) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_child", childTool("child_read", "read")))

        val task = m.model.content("msg1", "part_task") as Tool
        assertEquals("ses_child", task.childSessionId)
        assertEquals(1, task.childTools.size)
        assertEquals("read", task.childTools[0].name)
        assertNull(m.model.content("child_msg", "child_read"))
        assertTrue(modelEvents.any { it.toString() == "ContentUpdated msg1/part_task" })
    }

    fun `test child tool removed updates parent task part`() {
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_child", childTool("child_read", "read")), flush = false)
        emit(ChatEventDto.PartRemoved("ses_child", "child_msg", "child_read"))

        val task = m.model.content("msg1", "part_task") as Tool
        assertTrue(task.childTools.isEmpty())
    }

    fun `test history load backfills child tools`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
        rpc.histories["ses_test"] = mutableListOf(
            MessageWithPartsDto(
                msg("msg1", "ses_test", "assistant"),
                listOf(taskPart("ses_child").part),
            ),
        )
        rpc.histories["ses_child"] = mutableListOf(
            MessageWithPartsDto(
                msg("child_msg", "ses_child", "assistant"),
                listOf(childTool("child_read", "read"), childTool("child_grep", "grep")),
            ),
        )

        val m = controller("ses_test")
        flush()

        val task = m.model.content("msg1", "part_task") as Tool
        assertEquals(listOf("read", "grep"), task.childTools.map { it.name })
        assertNull(m.model.content("child_msg", "child_read"))
    }

    fun `test stale child history does not overwrite live child tool update`() {
        rpc.historyGate = CompletableDeferred()
        rpc.histories["ses_child"] = mutableListOf(
            MessageWithPartsDto(
                msg("child_msg", "ses_child", "assistant"),
                listOf(childTool("child_read", "grep")),
            ),
        )
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_child", childTool("child_read", "read")))

        var task = m.model.content("msg1", "part_task") as Tool
        assertEquals(listOf("read"), task.childTools.map { it.name })

        rpc.historyGate!!.complete(Unit)
        flush()

        task = m.model.content("msg1", "part_task") as Tool
        assertEquals(listOf("read"), task.childTools.map { it.name })
    }

    fun `test stale child history does not resurrect live removed child tool`() {
        rpc.historyGate = CompletableDeferred()
        rpc.histories["ses_child"] = mutableListOf(
            MessageWithPartsDto(
                msg("child_msg", "ses_child", "assistant"),
                listOf(childTool("child_read", "read")),
            ),
        )
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_child", childTool("child_read", "read")), flush = false)
        emit(ChatEventDto.PartRemoved("ses_child", "child_msg", "child_read"))

        var task = m.model.content("msg1", "part_task") as Tool
        assertTrue(task.childTools.isEmpty())

        rpc.historyGate!!.complete(Unit)
        flush()

        task = m.model.content("msg1", "part_task") as Tool
        assertTrue(task.childTools.isEmpty())
    }

    fun `test task child rekey cancels old child subscription`() {
        val closed = CopyOnWriteArrayList<String>()
        rpc.eventFlow = { id, _ -> rpc.events.onCompletion { closed.add(id) } }
        val (m, _, _) = prompted()
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(taskPart("ses_child"))
        emit(taskPart("ses_new"))
        settle()

        assertTrue("closed=$closed", closed.contains("ses_child"))

        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("old_perm", "ses_child")), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_new", childPermission("new_perm", "ses_new")))

        assertTrue(m.model.state is SessionState.AwaitingPermission)
        val perm = (m.model.state as SessionState.AwaitingPermission).permission
        assertEquals("new_perm", perm.id)
        assertEquals("ses_new", perm.sessionId)
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
            input = mapOf("subagent_type" to "explore", "description" to "Find files"),
        ),
    )

    private fun childTool(id: String, name: String) = PartDto(
        id = id,
        sessionID = "ses_child",
        messageID = "child_msg",
        type = "tool",
        tool = name,
        state = "completed",
        input = mapOf("filePath" to "src/Main.kt", "pattern" to "query"),
    )

    private fun childPermission(id: String, sid: String = "ses_child") = PermissionRequestDto(
        id = id,
        sessionID = sid,
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

    private fun planQuestion(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Ready to implement?",
                header = "Implement",
                options = listOf(
                    QuestionOptionDto("Start new session", "Implement in a fresh session with a clean context"),
                    QuestionOptionDto("Continue here", "Implement the plan in this session", mode = "code"),
                ),
                multiple = false,
                custom = true,
            ),
        ),
    )

    private fun planWorkspace() = workspaceReady(
        agents = listOf(
            AgentDto(name = "plan", displayName = "Plan", mode = "plan"),
            AgentDto(name = "code", displayName = "Code", mode = "code"),
        ),
        default = "plan",
        providers = listOf(
            ProviderDto(
                id = "kilo",
                name = "Kilo",
                models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5")),
            ),
            ProviderDto(
                id = "anthropic",
                name = "Anthropic",
                models = mapOf("claude" to ModelDto(id = "claude", name = "Claude")),
            ),
        ),
        connected = listOf("kilo", "anthropic"),
        defaults = mapOf("plan" to "kilo/gpt-5", "code" to "kilo/gpt-5"),
    )
}
