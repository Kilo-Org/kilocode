package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.PermissionRequestState
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto

class PermissionQueueTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        edt { KiloPluginSettings.unsetAutoApprove() }
    }

    fun `test two permissions advance in FIFO order`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm2")))

        assertPermission(m, "perm1")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertPermission(m, "perm2")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm2"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test duplicate permission ask does not reset active card`() {
        val (m, _, events) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1", "edit")))
        events.clear()
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1", "read")))

        assertPermission(m, "perm1", "edit")
        assertModelEvents("", events)
    }

    fun `test non-front resolution leaves active permission shown`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm2")))
        emit(ChatEventDto.PermissionReplied("ses_test", "perm2"))

        assertPermission(m, "perm1")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test recovered permissions advance in FIFO order`() {
        rpc.pendingPermissionList.add(permission("perm1"))
        rpc.pendingPermissionList.add(permission("perm2"))
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()

        val m = controller("ses_test")
        flush()

        assertPermission(m, "perm1")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertPermission(m, "perm2")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm2"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test late permission reply while idle does not force busy`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionReplied("ses_test", "perm_gone"))

        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test turn close purges outstanding permission ghost`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        assertPermission(m, "perm1")

        // The CLI abandons an outstanding permission server-side when a turn is interrupted, without
        // emitting permission.replied, so TurnClose must drop the ghost instead of leaving it shown.
        emit(ChatEventDto.TurnClose("ses_test", "aborted"))
        assertTrue(m.model.state is SessionState.Idle)

        // The next request surfaces itself rather than the purged ghost (which would fail to reply).
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm2")))
        assertPermission(m, "perm2")
    }

    fun `test session idle purges outstanding permission ghost`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        assertPermission(m, "perm1")

        emit(ChatEventDto.SessionIdle("ses_test"))
        assertTrue(m.model.state is SessionState.Idle)

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm2")))
        assertPermission(m, "perm2")
    }

    fun `test stop purges outstanding permission ghost`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        assertPermission(m, "perm1")

        edt { m.abort() }
        flush()
        assertTrue(m.model.state is SessionState.Idle)

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm2")))
        assertPermission(m, "perm2")
    }

    fun `test auto approve skill shell permissions stay queued in FIFO order`() {
        edt { KiloPluginSettings.setAutoApprove(true) }
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", skillPermission("perm1")))
        emit(ChatEventDto.PermissionAsked("ses_test", skillPermission("perm2")))

        assertPermission(m, "perm1")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertPermission(m, "perm2")
    }

    fun `test auto approve failure card is queued and purged by stop`() {
        edt { KiloPluginSettings.setAutoApprove(true) }
        rpc.replyPermissionThrows = RuntimeException("boom")
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        flush()

        // The failed auto-approval surfaces as an error card; it must be in the queue so purge sees it.
        val state = m.model.state as? SessionState.AwaitingPermission ?: error("Expected error card")
        assertEquals("perm1", state.permission.id)
        assertEquals(PermissionRequestState.ERROR, state.permission.state)

        edt { m.abort() }
        flush()
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test auto approve drain queues multiple skill shell permissions`() {
        rpc.pendingPermissionList.add(skillPermission("perm1"))
        rpc.pendingPermissionList.add(skillPermission("perm2"))
        val (m, _, _) = prompted()

        edt { m.setAutoApprove(true) }
        flush()

        assertPermission(m, "perm1")

        emit(ChatEventDto.PermissionReplied("ses_test", "perm1"))
        assertPermission(m, "perm2")
    }

    fun `test toggling auto approve on keeps a visible skill shell card queued for purge`() {
        // A skill-shell card is up while auto-approve is off; enabling auto-approve must not strand it.
        // Skill-shell asks always need a human, so setAutoApprove re-shows the card via show(); that
        // enqueue has to survive pending.clear() (be the last writer) or the card becomes a ghost that
        // is no longer in pending, which a later Stop could not purge and answering would NotFoundError.
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", skillPermission("perm1")))
        assertPermission(m, "perm1")

        edt { m.setAutoApprove(true) }
        flush()

        // Still shown, and still tracked in pending — so Stop can clear it.
        assertPermission(m, "perm1")

        edt { m.abort() }
        flush()
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test toggling auto approve on keeps skill shell card while draining other permissions`() {
        // Visible skill-shell card plus another auto-approvable permission on the server. Enabling
        // auto-approve drains/replies the other one, but the drain must not flip the preserved
        // skill-shell card to Busy — that would hide it with no reply path left.
        rpc.pendingPermissionList.add(permission("perm2"))
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", skillPermission("perm1")))
        assertPermission(m, "perm1")

        edt { m.setAutoApprove(true) }
        flush()

        assertTrue(rpc.permissionReplies.any { it.first == "perm2" })
        assertPermission(m, "perm1")

        edt { m.abort() }
        flush()
        assertTrue(m.model.state is SessionState.Idle)
    }

    fun `test replying active question shows queued permission`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        assertTrue(m.model.state is SessionState.AwaitingQuestion)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("A")))) }
        emit(ChatEventDto.QuestionReplied("ses_test", "q1"))

        assertPermission(m, "perm1")
    }

    fun `test status idle keeps a promoted child permission instead of clobbering to idle`() {
        // A root card in front of a queued child permission: when the root session reports idle,
        // purgePending clears the root card and promotes the child's still-live permission. The
        // status handler must leave that promotion in place rather than overwriting it with Idle.
        val (m, _, _) = prompted()

        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))
        emit(taskPart("ses_child"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child", childPermission("child_perm1")))
        assertPermission(m, "perm1")

        emit(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("idle")))

        assertPermission(m, "child_perm1")
    }

    private fun taskPart(child: String) = ChatEventDto.PartUpdated(
        sessionID = "ses_test",
        part = PartDto(
            id = "part_task",
            sessionID = "ses_test",
            messageID = "msg1",
            type = "tool",
            tool = "task",
            metadata = mapOf("sessionId" to child),
            input = mapOf("subagent_type" to "explore", "description" to "Find files"),
        ),
    )

    private fun childPermission(id: String) = PermissionRequestDto(
        id = id,
        sessionID = "ses_child",
        permission = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
    )

    private fun assertPermission(c: SessionController, id: String, name: String = "edit") {
        val state = c.model.state as? SessionState.AwaitingPermission ?: error("Expected AwaitingPermission")
        assertEquals(id, state.permission.id)
        assertEquals(name, state.permission.name)
    }

    private fun permission(id: String, name: String = "edit") = PermissionRequestDto(
        id = id,
        sessionID = "ses_test",
        permission = name,
        patterns = listOf("*.kt"),
        always = emptyList(),
    )

    private fun skillPermission(id: String) = permission(id).copy(metadata = mapOf("skillShell" to "true"))

    private fun question(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(QuestionInfoDto("Pick one", "Choice")),
    )
}
