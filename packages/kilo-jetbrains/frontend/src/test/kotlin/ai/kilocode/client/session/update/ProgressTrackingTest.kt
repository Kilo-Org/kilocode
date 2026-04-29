package ai.kilocode.client.session.update

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto

/**
 * Verifies that:
 * 1. `step-start` and `step-finish` parts are silently dropped at the model level.
 * 2. [SessionState.Busy.text] carries the right progress string throughout a turn.
 * 3. [SessionModelEvent.StateChanged] fires with correct [SessionState.Busy] text
 *    as parts arrive.
 * 4. Progress is cleared (state → Idle) on terminal events.
 */
class ProgressTrackingTest : SessionControllerTestBase() {

    // ------ silent part types ------

    fun `test step-start part is silently dropped from model`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p1", "ses_test", "msg1", "step-start")))

        assertNull(m.model.message("msg1")!!.parts["p1"])
        assertFalse(modelEvents.any { it is SessionModelEvent.ContentAdded })
    }

    fun `test step-finish part is silently dropped from model`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p2", "ses_test", "msg1", "step-finish")))

        assertNull(m.model.message("msg1")!!.parts["p2"])
        assertFalse(modelEvents.any { it is SessionModelEvent.ContentAdded })
    }

    // ------ progress text per turn event ------

    fun `test TurnOpen sets state to Busy with considering text`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))

        assertSession(
            """
            [code] [kilo/gpt-5] [busy] [considering next steps]
            """,
            m,
        )
    }

    fun `test PartUpdated reasoning sets Busy text to thinking`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p1", "ses_test", "msg1", "reasoning")))

        assertSession(
            """
            assistant#msg1
            reasoning#p1:
              <empty>

            [code] [kilo/gpt-5] [busy] [thinking]
            """,
            m,
        )
    }

    fun `test PartUpdated bash tool sets Busy text to running commands`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p1", "ses_test", "msg1", "tool", tool = "bash")))

        assertSession(
            """
            assistant#msg1
            tool#p1 bash [PENDING]

            [code] [kilo/gpt-5] [busy] [running commands]
            """,
            m,
        )
    }

    fun `test PartUpdated edit tool sets Busy text to making edits`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p1", "ses_test", "msg1", "tool", tool = "edit")))

        val state = m.model.state as SessionState.Busy
        assertTrue(state.text.contains("edits", ignoreCase = true))
    }

    // ------ terminal events clear progress ------

    fun `test TurnClose transitions to Idle`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.TurnClose("ses_test", "completed"))

        assertSession(
            """
            [code] [kilo/gpt-5] [idle]
            """,
            m,
        )
    }

    fun `test Error clears progress`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "timeout", message = "Timed out")))

        assertSession(
            """
            [code] [kilo/gpt-5] [error] [Timed out]
            """,
            m,
        )
    }

    // ------ StateChanged event stream ------

    fun `test StateChanged Busy fires with considering text on TurnOpen`() {
        val (_, _, modelEvents) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))

        val busyEvents = modelEvents.filterIsInstance<SessionModelEvent.StateChanged>()
            .filter { it.state is SessionState.Busy }
        assertFalse(busyEvents.isEmpty())
        val text = (busyEvents.last().state as SessionState.Busy).text
        assertTrue(text.contains("Considering", ignoreCase = true))
    }

    fun `test StateChanged Busy fires with updated text on PartUpdated`() {
        val (_, _, modelEvents) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("p1", "ses_test", "msg1", "tool", tool = "bash")))

        val last = modelEvents.filterIsInstance<SessionModelEvent.StateChanged>()
            .lastOrNull { it.state is SessionState.Busy }
        assertNotNull(last)
        val text = (last!!.state as SessionState.Busy).text
        assertTrue(text.contains("Running", ignoreCase = true))
    }
}
