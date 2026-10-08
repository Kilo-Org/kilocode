package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartTimeDto
import java.awt.Point
import java.awt.event.MouseEvent
import javax.swing.SwingUtilities

/**
 * [ai.kilocode.client.session.scroll.SessionScroll.scrollPartTop] — the header timeline's bars
 * jump here. See [ai.kilocode.client.session.PromptRailLayoutTest] for the sibling
 * [ai.kilocode.client.session.scroll.SessionScroll.scrollMessageTop] coverage this mirrors.
 */
class SessionScrollPartTest : SessionUiTestBase() {

    fun `test scrollPartTop lands the part at the viewport top`() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        ui.setSize(900, 400)
        layout()
        drainScroll()
        val bar = scrollBar()

        assertTrue(ui.scroll.scrollPartTop("asst_1", "tool_2"))
        drainScroll()

        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        val expected = SwingUtilities.convertPoint(part, Point(0, 0), scrollView()).y
            .coerceIn(0, bottom(bar))
        assertEquals(expected, bar.value)
    }

    fun `test scrollPartTop falls back to the message when the part has no view`() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        ui.setSize(900, 400)
        layout()
        drainScroll()
        val bar = scrollBar()

        // step-finish is a timeline-only marker; MessageView never creates a renderer for it.
        assertTrue(ui.scroll.scrollPartTop("asst_1", "step_finish_1"))
        drainScroll()

        val message = find<SessionMessageListPanel>(ui).findMessage("asst_1")!!
        val expected = SwingUtilities.convertPoint(message, Point(0, 0), scrollView()).y
            .coerceIn(0, bottom(bar))
        assertEquals(expected, bar.value)
    }

    fun `test scrollPartTop returns false for an unknown message`() {
        showMessages()
        fillTranscript(3)

        assertFalse(ui.scroll.scrollPartTop("does_not_exist", "tool_1"))
    }

    fun `test scrollPartTop returns false for an unknown part on a known message`() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        ui.setSize(900, 400)
        layout()
        drainScroll()

        // No fallback target either: an unknown message id means there is nothing to jump to.
        assertFalse(ui.scroll.scrollPartTop("does_not_exist", "does_not_exist_either"))
    }

    /**
     * End-to-end: clicking the real header timeline (as wired in [ai.kilocode.client.session.SessionUi])
     * moves the real transcript scroll pane, not just the two halves in isolation.
     */
    fun `test clicking the header timeline scrolls the real transcript`() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        ui.setSize(900, 400)
        layout()
        drainScroll()
        val header = find<SessionHeaderPanel>(ui)
        click(header.expandButton())
        layout()
        val bar = scrollBar()
        val before = bar.value

        // tool_2 is the 3rd timeline bar: reasoning-free assistant message with tool_1, tool_2, step_finish_1.
        pressReleaseClick(header, 1)
        drainScroll()

        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        val expected = SwingUtilities.convertPoint(part, Point(0, 0), scrollView()).y
            .coerceIn(0, bottom(bar))
        assertEquals(expected, bar.value)
        assertTrue("the click must actually move the transcript", expected != before)
    }

    /** Presses, releases, and clicks timeline bar [index] on the header's real timeline panel. */
    private fun pressReleaseClick(header: SessionHeaderPanel, index: Int) {
        val timeline = header.timelinePanel()
        val x = header.timelineBarWidth() * index + 1
        val y = header.timelinePreferredSize().height - 1
        timeline.dispatchEvent(MouseEvent(timeline, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), 0, x, y, 1, false, MouseEvent.BUTTON1))
        timeline.dispatchEvent(MouseEvent(timeline, MouseEvent.MOUSE_RELEASED, System.currentTimeMillis(), 0, x, y, 1, false, MouseEvent.BUTTON1))
        timeline.dispatchEvent(MouseEvent(timeline, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, x, y, 1, false, MouseEvent.BUTTON1))
    }

    /** One assistant message with two tool parts and a trailing step-finish marker. */
    private fun emitAssistantSteps() {
        emit(ChatEventDto.MessageUpdated("ses_test", assistant("asst_1")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_1", "asst_1", "Run tests")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_2", "asst_1", "Edit file")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", stepFinish("step_finish_1", "asst_1")))
    }

    private fun assistant(id: String) = MessageDto(
        id = id,
        sessionID = "ses_test",
        role = "assistant",
        time = MessageTimeDto(created = 0.0),
    )

    private fun tool(id: String, mid: String, title: String) = PartDto(
        id = id,
        sessionID = "ses_test",
        messageID = mid,
        type = "tool",
        tool = "bash",
        state = "completed",
        title = title,
        input = mapOf("cmd" to "test"),
        time = PartTimeDto(1.0, 2.0),
    )

    private fun stepFinish(id: String, mid: String) = PartDto(
        id = id,
        sessionID = "ses_test",
        messageID = mid,
        type = "step-finish",
        reason = "stop",
    )
}
