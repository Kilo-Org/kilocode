package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.rpc.dto.MessageWithPartsDto

class HistoryLoadingTest : SessionControllerTestBase() {

    fun `test existing session loads history on init`() {
        val m = msg("msg1", "ses_test", "user")
        val part = part("prt1", "ses_test", "msg1", "text", text = "hello")
        rpc.history.add(MessageWithPartsDto(m, listOf(part)))

        val c = controller("ses_test")
        val modelEvents = collectModelEvents(c)
        flush()

        assertModelEvents("HistoryLoaded", modelEvents)
        assertModel(
            """
            user#msg1
            text#prt1:
              hello
            """,
            c,
        )
    }

    fun `test non-empty history shows messages view`() {
        rpc.history.add(MessageWithPartsDto(msg("msg1", "ses_test", "user"), emptyList()))

        val c = controller("ses_test")
        val events = collect(c)
        flush()

        // ViewChanged progress fires immediately on controller construction (step 3 of plan).
        // ViewChanged session fires after non-empty history is loaded.
        assertControllerEvents("""
            AppChanged
            WorkspaceChanged
            ViewChanged progress
            ViewChanged session
        """, events)

        assertSession(
            """
            user#msg1

            [app: DISCONNECTED] [workspace: PENDING]
            """,
            c,
        )
    }

    fun `test empty explicit session history shows messages view`() {
        rpc.recent.add(session("ses_recent"))

        val c = controller("ses_test")
        val events = collect(c)
        val modelEvents = collectModelEvents(c)
        flush()

        assertTrue(rpc.recentCalls.isEmpty())
        assertModelEvents("HistoryLoaded", modelEvents)
        assertControllerEvents("""
            AppChanged
            WorkspaceChanged
            ViewChanged progress
            ViewChanged session
        """, events)
        assertSession(
            """
            [app: DISCONNECTED] [workspace: PENDING]
            """,
            c,
        )
    }
}
