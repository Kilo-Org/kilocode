package ai.kilocode.client.session

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto

class SessionSearchTest : SessionUiTestBase() {
    fun `test find searches conversation prose and navigates matches`() {
        showMessages()
        textMessage("user_1", "hello from the transcript")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "hello"

        assertTrue(
            "initial user prompt is found",
            pumpUntil { ui.search.hasMatches() && bar.statusText == "1 of 1" },
        )

        assistant("asst_1", "hello from the assistant")
        assertTrue(
            "live assistant prose joins the result set",
            pumpUntil { bar.statusText == "1 of 2" },
        )

        ui.search.searchForward()
        assertTrue("next wraps to the second match", pumpUntil { bar.statusText == "2 of 2" })

        ui.search.searchBackward()
        assertTrue("previous returns to the first match", pumpUntil { bar.statusText == "1 of 2" })

        ui.search.close()
        assertTrue("closing clears the counter", bar.statusText.isEmpty())
        assertFalse(ui.search.hasMatches())

        ui.search.searchBackward()
        assertTrue(
            "find previous reopens and starts at the last match",
            pumpUntil { bar.statusText == "2 of 2" },
        )
        ui.search.close()
    }

    fun `test find does not include tool content`() {
        showMessages()
        textMessage("user_1", "hello from the transcript")
        assistantTool("asst_tool", "hello tool output")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "hello"

        assertTrue("only the user prompt matches", pumpUntil { bar.statusText == "1 of 1" })
    }

    private fun textMessage(id: String, text: String) {
        emit(
            ChatEventDto.MessageUpdated("ses_test", MessageDto(id, "ses_test", "user", MessageTimeDto(0.0))),
            flush = false,
        )
        emit(ChatEventDto.PartUpdated("ses_test", part("${id}_text", id, "text", text)), flush = false)
        settle()
        forceFlush()
        drainScroll()
    }

    private fun assistant(id: String, text: String) {
        emit(
            ChatEventDto.MessageUpdated("ses_test", MessageDto(id, "ses_test", "assistant", MessageTimeDto(0.0))),
            flush = false,
        )
        emit(ChatEventDto.PartUpdated("ses_test", part("${id}_text", id, "text", text)), flush = false)
        settle()
        forceFlush()
        drainScroll()
    }

    private fun assistantTool(id: String, output: String) {
        emit(
            ChatEventDto.MessageUpdated("ses_test", MessageDto(id, "ses_test", "assistant", MessageTimeDto(0.0))),
            flush = false,
        )
        emit(
            ChatEventDto.PartUpdated(
                "ses_test",
                part("${id}_tool", id, "tool").copy(tool = "grep", output = output),
            ),
            flush = false,
        )
        settle()
        forceFlush()
        drainScroll()
    }
}