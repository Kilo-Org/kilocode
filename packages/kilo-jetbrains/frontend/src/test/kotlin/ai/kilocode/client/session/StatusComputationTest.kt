package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.rpc.dto.ChatEventDto

class StatusComputationTest : SessionControllerTestBase() {

    fun `test status shows tool-specific text`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.TurnOpen("ses_test"))

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash")))

        assertSession(
            """
            assistant#msg1
            tool#prt1 bash [PENDING]

            [code] [kilo/gpt-5] [busy] [running commands]
            """,
            m,
        )
    }

    fun `test PartUpdated after TurnClose does not fire StateChanged`() {
        val (_, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.TurnClose("ses_test", "completed"))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "late")))

        assertModelEvents("""
            MessageAdded msg1
            TurnAdded msg1 [msg1]
            StateChanged Busy
            StateChanged Idle
            ContentAdded msg1/prt1
        """, modelEvents)
    }
}
