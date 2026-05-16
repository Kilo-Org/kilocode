package ai.kilocode.client.session.update

import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageTimeDto

class MessageListTest : SessionControllerTestBase() {

    fun `test MessageUpdated adds message to SessionModel`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        // MessageAdded fires first; TurnAdded fires after regroup
        assertModelEvents("""
            MessageAdded msg1
            TurnAdded msg1 [msg1]
        """, modelEvents)
        assertNotNull(m.model.message("msg1"))
    }

    fun `test MessageUpdated second event updates existing message`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        // Second update for the same message ID (e.g. tokens/cost finalized)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        // Should fire MessageUpdated, not MessageAdded
        assertModelEvents("MessageUpdated msg1", modelEvents)
        assertNotNull(m.model.message("msg1"))
    }

    fun `test MessageUpdated second event preserves existing parts`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "hello")))

        // Update the message info (should not wipe parts)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        assertNotNull(m.model.message("msg1")!!.parts["prt1"])
    }

    fun `test PartUpdated text updates SessionModel`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "hello")))

        assertModelEvents("""
            MessageAdded msg1
            TurnAdded msg1 [msg1]
            ContentAdded msg1/prt1
        """, modelEvents)
        assertModel(
            """
            assistant#msg1
            text#prt1:
              hello
            """,
            m,
        )
    }

    fun `test PartDelta appends text to SessionModel`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "hello "), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "world"))

        assertModel(
            """
            assistant#msg1
            text#prt1:
              hello world
            """,
            m,
        )
    }

    fun `test PartRemoved removes content from message`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "hello")))
        modelEvents.clear()

        emit(ChatEventDto.PartRemoved("ses_test", "msg1", "prt1"))

        assertNull(m.model.message("msg1")!!.parts["prt1"])
        assertModelEvents("ContentRemoved msg1/prt1", modelEvents)  // no regroup for content ops
    }

    fun `test PartRemoved unknown part is noop`() {
        val (m, _, modelEvents) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartRemoved("ses_test", "msg1", "no_such_part"))

        assertTrue(modelEvents.isEmpty())
    }

    fun `test MessageRemoved removes from SessionModel`() {
        val (m, _, _) = prompted()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "user")))
        assertNotNull(m.model.message("msg1"))

        emit(ChatEventDto.MessageRemoved("ses_test", "msg1"))
        assertNull(m.model.message("msg1"))
    }
}
