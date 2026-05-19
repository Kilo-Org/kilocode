package ai.kilocode.client.session.controller

import ai.kilocode.client.session.SessionRef
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.QuestionReplyDto

/**
 * Tests for the plan follow-up session adoption flow.
 *
 * Covers:
 * - `Start new session` reply records pending follow-up and adopts the created session.
 * - `Continue here` reply does not record follow-up.
 * - Wrong-directory `session.created` is not adopted.
 * - Expired pending follow-up is not adopted.
 */
class FollowupSessionTest : SessionControllerTestBase() {

    fun `test Start new session reply triggers adoption of matching created session`() {
        val opened = mutableListOf<SessionRef>()
        val m = setup(opened = opened)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("Start new session")))) }
        flush()

        val created = session("ses_impl", dir = "/test")
        emit(ChatEventDto.SessionCreated("ses_impl", created))

        assertEquals("open callback should receive the new session", 1, opened.size)
        val ref = opened[0]
        assertTrue("Should open a Local ref", ref is SessionRef.Local)
        assertEquals("ses_impl", (ref as SessionRef.Local).id)
    }

    fun `test Continue here reply does not adopt created session`() {
        val opened = mutableListOf<SessionRef>()
        val m = setup(opened = opened)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("Continue here")))) }
        flush()

        val created = session("ses_impl", dir = "/test")
        emit(ChatEventDto.SessionCreated("ses_impl", created))

        assertTrue("open callback should NOT be called for Continue here", opened.isEmpty())
    }

    fun `test Wrong directory session created is not adopted`() {
        val opened = mutableListOf<SessionRef>()
        val m = setup(opened = opened)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("Start new session")))) }
        flush()

        val created = session("ses_other", dir = "/other")
        emit(ChatEventDto.SessionCreated("ses_other", created))

        assertTrue("open callback should NOT be called for wrong directory", opened.isEmpty())
    }

    fun `test Expired pending followup is not adopted`() {
        var clock = 0L
        val opened = mutableListOf<SessionRef>()
        val m = setup(opened = opened, now = { clock })

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("Start new session")))) }
        flush()

        // Advance clock past TTL
        clock = 31_000L

        val created = session("ses_impl", dir = "/test")
        emit(ChatEventDto.SessionCreated("ses_impl", created))

        assertTrue("open callback should NOT be called after TTL expires", opened.isEmpty())
    }

    fun `test Reject question clears pending followup`() {
        val opened = mutableListOf<SessionRef>()
        val m = setup(opened = opened)

        edt { m.replyQuestion("q1", QuestionReplyDto(listOf(listOf("Start new session")))) }
        flush()
        edt { m.rejectQuestion("q2") }
        flush()

        val created = session("ses_impl", dir = "/test")
        emit(ChatEventDto.SessionCreated("ses_impl", created))

        assertTrue("open callback should NOT be called after reject clears followup", opened.isEmpty())
    }

    // ------ helpers ------

    /**
     * Creates a ready controller that is subscribed to events (via prompt flow)
     * with a custom [open] callback and optional [now] clock.
     */
    private fun setup(
        opened: MutableList<SessionRef>,
        now: () -> Long = { System.currentTimeMillis() },
    ): SessionController {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller(
            flushMs = Long.MAX_VALUE,
            condense = true,
            open = { ref -> opened.add(ref) },
            now = now,
        )
        flush()
        edt { m.prompt("go") }
        flush()
        return m
    }
}
