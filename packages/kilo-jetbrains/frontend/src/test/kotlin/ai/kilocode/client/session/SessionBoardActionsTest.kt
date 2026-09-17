package ai.kilocode.client.session

import ai.kilocode.client.session.board.SessionBoardDialog
import com.intellij.openapi.util.Disposer
import ai.kilocode.rpc.dto.BoardMessageDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SessionBoardDto

/**
 * [SessionActions.board] gating: a created, writable, local root session with Kilo Swarm enabled
 * **and** a non-empty board. Never drives [SessionActions.showBoard] — that opens a real modal
 * [ai.kilocode.client.session.board.SessionBoardDialog], which dialog tests here never show.
 */
@Suppress("UnstableApiUsage")
class SessionBoardActionsTest : SessionUiTestBase() {

    private fun swarm(enabled: Boolean?) {
        app._state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(shared_agent_board = enabled),
        )
    }

    private fun board(messages: Int) {
        rpc.board = SessionBoardDto(
            ownerSessionID = "ses_test",
            revision = 1,
            messages = (1..messages).map {
                BoardMessageDto(id = "m$it", timestamp = 0, from = "main", to = "ALL", type = "INFO", body = "note $it")
            },
            hasMore = false,
        )
    }

    private fun open(id: String? = "ses_test") {
        ui = newUi(id = id)
        settle()
        layout()
    }

    // ---- the board probe ----

    fun `test board is false on an empty board even with swarm on`() {
        board(messages = 0)
        open()

        assertFalse(actions().board)
    }

    fun `test board is true once the board has a message`() {
        board(messages = 1)
        open()

        assertTrue(actions().board)
    }

    fun `test probe asks for a single message and targets the session directory`() {
        board(messages = 1)
        open()

        val call = rpc.sessionBoardCalls.first()
        assertEquals("ses_test", call.first)
        assertNull(call.second)
        assertEquals(1, call.third)
    }

    fun `test probe failure leaves the entry points hidden`() {
        board(messages = 1)
        rpc.sessionBoardThrows = IllegalStateException("boom")
        open()

        assertFalse(actions().board)
    }

    fun `test message traffic does not re-probe once the board is known non-empty`() {
        board(messages = 1)
        open()
        assertTrue(actions().board)
        val probes = rpc.sessionBoardCalls.size

        emit(ChatEventDto.MessageUpdated("ses_test", message("msg_extra")))
        settle()

        assertEquals(probes, rpc.sessionBoardCalls.size)
    }

    fun `test an empty board keeps probing as messages arrive`() {
        board(messages = 0)
        open()
        val probes = rpc.sessionBoardCalls.size

        board(messages = 1)
        emit(ChatEventDto.MessageUpdated("ses_test", message("msg_extra")))
        settle()

        assertTrue(rpc.sessionBoardCalls.size > probes)
        assertTrue(actions().board)
    }

    // ---- surface gating ----

    fun `test board defaults to on when config does not set the key`() {
        board(messages = 1)
        swarm(null)
        open()

        assertTrue(actions().board)
    }

    fun `test board is false when the toggle is off`() {
        board(messages = 1)
        open()
        swarm(false)

        assertFalse(actions().board)
    }

    fun `test board is false for a readonly session`() {
        board(messages = 1)
        val readonly = newUi(id = "ses_test", manager = object : SessionManager {
            override val readonly: Boolean get() = true
            override fun newSession() {}
            override fun showHistory(back: (() -> Unit)?) {}
            override fun openSession(ref: SessionRef) {}
        })
        settle()

        assertFalse((readonly as SessionActions).board)
    }

    fun `test board is false before the session is created`() {
        board(messages = 1)
        open(id = null)

        assertFalse(actions().board)
    }

    fun `test board is false for a subagent session`() {
        board(messages = 1)
        rpc.session = rpc.session.copy(parentID = "ses_parent")
        open()

        assertFalse(actions().board)
    }

    /**
     * A cloud ref is imported into a real local session (`SessionController.importCloud`), so once
     * it resolves it owns a board like any other local session. Before that, `controller.id` is null
     * because it only resolves for a local ref, which is what keeps the entry points hidden.
     */
    fun `test an imported cloud session is eligible once it resolves to a local session`() {
        board(messages = 1)
        open(id = "${SessionRef.CLOUD_PREFIX}abc")

        assertEquals(SessionRef.Type.LOCAL, controller().refType)
        assertTrue(actions().board)
    }

    fun `test an unavailable board is not probed at all`() {
        board(messages = 1)
        open(id = null)

        assertTrue(rpc.sessionBoardCalls.isEmpty())
    }

    /**
     * The board is non-modal, so it outlives showBoard(). It must be registered on the session:
     * otherwise closing the session tab leaves the window alive holding a disposed SessionUi, its
     * service, and the dialog's own coroutine scope. Disposing a DialogWrapper's disposable calls
     * DialogWrapper.dispose(), so registering it under the session closes the board with the tab.
     */
    fun `test open board is disposed with the session`() {
        board(messages = 1)
        open()
        assertTrue(actions().board)

        val dialog = SessionBoardDialog(
            ui, project, "ses_test", "Test", "/repo", listOf("main"), sessions,
        ) { _, _ -> }
        Disposer.register(ui, dialog.disposable)

        Disposer.dispose(ui)

        assertTrue("closing the session must dispose the board dialog", dialog.isDisposed)
    }

    private fun actions(): SessionActions = ui
}
