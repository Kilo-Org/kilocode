package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.md.MAX_SEARCH_HIGHLIGHTS
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.util.ui.JBUI

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

    fun `test match counter reports the full result set when highlights are capped`() {
        showMessages()
        textMessage("user_1", "needle ".repeat(MAX_SEARCH_HIGHLIGHTS + 100))

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "needle"

        assertTrue(
            "counter includes matches beyond the highlight cap",
            pumpUntil { bar.statusText == "1 of ${MAX_SEARCH_HIGHLIGHTS + 100}" },
        )
        ui.search.close()
    }

    fun `test results refresh while a response streams continuously`() {
        showMessages()
        textMessage("user_1", "hello")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "hello"
        assertTrue("initial match is found", pumpUntil { bar.statusText == "1 of 1" })

        emit(
            ChatEventDto.MessageUpdated("ses_test", MessageDto("asst_stream", "ses_test", "assistant", MessageTimeDto(0.0))),
            flush = false,
        )
        var content = "hello"
        emit(ChatEventDto.PartUpdated("ses_test", part("asst_stream_text", "asst_stream", "text", content)), flush = false)
        forceFlushWithoutDispatch()

        var refreshed = false
        repeat(20) {
            content += " hello"
            emit(
                ChatEventDto.PartUpdated("ses_test", part("asst_stream_text", "asst_stream", "text", content)),
                flush = false,
            )
            forceFlushWithoutDispatch()
            settleShort(20)
            if (bar.statusText.matches(Regex("1 of [2-9]\\d*"))) refreshed = true
        }

        assertTrue("the throttled refresh must run during a continuous stream", refreshed)
        ui.search.close()
    }

    fun `test find next from a closed bar reopens at the first match`() {
        showMessages()
        textMessage("user_long", "needle\n" + "filler\n".repeat(80))
        assistant("asst_1", "needle")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "needle"
        assertTrue("first match is selected", pumpUntil { bar.statusText == "1 of 2" })

        ui.search.searchForward()
        assertTrue("second match is selected", pumpUntil { bar.statusText == "2 of 2" })

        ui.search.close()
        ui.search.searchForward()

        assertTrue(
            "find next from closed starts at the first match, not the viewport",
            pumpUntil { bar.statusText == "1 of 2" },
        )
        ui.search.close()
    }

    fun `test find next during streaming advances instead of resetting`() {
        showMessages()
        textMessage("user_1", "hello")
        assistant("asst_1", "hello")
        assistant("asst_2", "hello")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "hello"
        assertTrue("first match is selected", pumpUntil { bar.statusText == "1 of 3" })

        emit(
            ChatEventDto.PartUpdated("ses_test", part("asst_1_text", "asst_1", "text", "hello extra")),
            flush = false,
        )
        forceFlushWithoutDispatch()
        settleShort(10)

        ui.search.searchForward()
        ui.search.searchForward()

        assertTrue(
            "repeated stale navigation advances to the last match",
            pumpUntil { bar.statusText == "3 of 3" },
        )
        ui.search.close()
    }

    fun `test closing during stale navigation resets the pending target`() {
        showMessages()
        textMessage("user_1", "hello")
        assistant("asst_1", "hello")
        assistant("asst_2", "hello")

        ui.search.open()
        val bar = ui.search.getComponent()
        bar.getSearchTextComponent().text = "hello"
        assertTrue("first match is selected", pumpUntil { bar.statusText == "1 of 3" })

        emit(
            ChatEventDto.PartUpdated("ses_test", part("asst_1_text", "asst_1", "text", "hello extra")),
            flush = false,
        )
        forceFlushWithoutDispatch()
        settleShort(10)

        ui.search.searchForward()
        ui.search.close()
        ui.search.searchForward()

        assertTrue(
            "reopening after close starts at the first match",
            pumpUntil { bar.statusText == "1 of 3" },
        )
        ui.search.close()
    }

    fun `test find bar uses the transcript content lane width`() {
        showMessages()
        ui.search.open()

        val bar = ui.search.getComponent()
        val host = ui.search.host
        host.setSize(800, bar.preferredSize.height + 20)
        host.doLayout()

        val panel = find<SessionMessageListPanel>(ui)
        val left = JBUI.scale(SessionUiStyle.SessionLayout.INNER_HORIZONTAL)
        val right = JBUI.scale(SessionUiStyle.SessionLayout.INNER_RIGHT)
        val available = 800 - left - right
        val expected = minOf(available, panel.searchLaneWidth())

        assertEquals("Find bar should match the transcript lane", expected, bar.width)
        assertEquals("Find bar should be centered in the transcript lane", left + (available - expected) / 2, bar.x)
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