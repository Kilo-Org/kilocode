package ai.kilocode.client.session.controller

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto

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

    fun `test replying active question shows queued permission`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")))
        emit(ChatEventDto.PermissionAsked("ses_test", permission("perm1")))

        assertTrue(m.model.state is SessionState.AwaitingQuestion)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("A")))) }
        emit(ChatEventDto.QuestionReplied("ses_test", "q1"))

        assertPermission(m, "perm1")
    }

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

    private fun question(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(QuestionInfoDto("Pick one", "Choice")),
    )
}
