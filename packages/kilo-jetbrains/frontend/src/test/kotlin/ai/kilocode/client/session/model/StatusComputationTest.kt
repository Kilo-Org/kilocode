package ai.kilocode.client.session.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.ChatEventDto

class StatusComputationTest : SessionModelTestBase() {

    fun `test status shows tool-specific text`() {
        val (_, events) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        flush()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash")))
        flush()

        val status = events.filterIsInstance<SessionEvent.StatusChanged>()
            .lastOrNull { it.text != null && it.text != KiloBundle.message("session.status.considering") }
        assertNotNull(status)
        assertEquals(KiloBundle.message("session.status.commands"), status!!.text)
    }

    fun `test PartUpdated after TurnClose does not fire StatusChanged`() {
        val (_, events) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        flush()
        emit(ChatEventDto.TurnOpen("ses_test"))
        flush()
        emit(ChatEventDto.TurnClose("ses_test", "completed"))
        flush()

        val before = events.filterIsInstance<SessionEvent.StatusChanged>().size

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "late")))
        flush()

        val after = events.filterIsInstance<SessionEvent.StatusChanged>().size
        assertEquals(before, after)
    }
}
