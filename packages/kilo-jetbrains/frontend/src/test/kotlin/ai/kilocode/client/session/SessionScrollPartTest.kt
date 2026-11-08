package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBScrollPane
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartTimeDto
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * [ai.kilocode.client.session.scroll.SessionScroll.scrollPartTop] — the header timeline's bars
 * jump here. See [ai.kilocode.client.session.PromptRailLayoutTest] for the sibling
 * [ai.kilocode.client.session.scroll.SessionScroll.scrollMessageTop] coverage this mirrors.
 */
class SessionScrollPartTest : SessionUiTestBase() {

    fun `test scrollPartTop reveals a part below the viewport with a gap above it`() {
        transcript()
        val bar = scrollBar()
        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        park(0)
        assertFalse(diag(part), visibleTop(part))

        assertTrue(ui.scroll.scrollPartTop("asst_1", "tool_2"))
        drainScroll()

        assertEquals(diag(part), (top(part) - UiStyle.Gap.pad()).coerceIn(0, bottom(bar)), bar.value)
        assertVisibleTop(part)
        // Revealed, not pinned flush: the gap is what keeps the outline's top stroke off the edge.
        assertEquals(UiStyle.Gap.pad(), top(part) - bar.value)
    }

    fun `test scrollPartTop does not move when the part top is already visible`() {
        transcript()
        val bar = scrollBar()
        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        // Park the part's top comfortably inside the viewport, then ask for it again.
        park((top(part) - UiStyle.Gap.pad() * 4).coerceIn(0, bottom(bar)))
        val parked = bar.value
        assertVisibleTop(part)

        assertTrue(ui.scroll.scrollPartTop("asst_1", "tool_2"))
        drainScroll()

        assertEquals("an already visible top must not move the transcript", parked, bar.value)
    }

    fun `test scrollPartTop reveals a part above the viewport`() {
        transcript()
        val bar = scrollBar()
        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_1")!!
        park(bottom(bar))
        assertFalse(diag(part), visibleTop(part))

        assertTrue(ui.scroll.scrollPartTop("asst_1", "tool_1"))
        drainScroll()

        assertEquals(diag(part), (top(part) - UiStyle.Gap.pad()).coerceIn(0, bottom(bar)), bar.value)
        assertVisibleTop(part)
    }

    fun `test scrollPartTop falls back to the message when the part has no view`() {
        transcript()
        val bar = scrollBar()
        park(0)

        // step-finish is a timeline-only marker; MessageView never creates a renderer for it.
        assertTrue(ui.scroll.scrollPartTop("asst_1", "step_finish_1"))
        drainScroll()

        val message = find<SessionMessageListPanel>(ui).findMessage("asst_1")!!
        assertEquals((top(message) - UiStyle.Gap.pad()).coerceIn(0, bottom(bar)), bar.value)
        assertVisibleTop(message)
    }

    /**
     * The assistant message sits in the middle of the transcript, with scroll room on both sides, so
     * a reveal is not clamped by the top or the bottom of the content and the tests can tell a real
     * reveal from a clamped one.
     *
     * The base `layout()` leaves the viewport with a zero extent, which would make every reveal
     * decision and every "is the top visible" assertion meaningless, so the whole tree is laid out.
     */
    private fun transcript() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        fillTranscript(10, start = 6)
        ui.setSize(900, 400)
        layoutAll(ui)
        drainScroll()
        layoutAll(ui)
        val vp = (scrollComponent() as JBScrollPane).viewport
        assertTrue("the viewport needs a real extent for reveal tests", vp.extentSize.height > 0)
    }

    /**
     * Parks the transcript at [value] as a user gesture. A passive move is re-pinned to the bottom by
     * the follow branch in onScroll, which would silently invalidate every reveal fixture here.
     */
    private fun park(value: Int) {
        setValue(scrollBar(), value)
        drainScroll()
    }

    private fun layoutAll(comp: Component) {
        comp.doLayout()
        if (comp is Container) comp.components.forEach(::layoutAll)
    }

    private fun top(target: JComponent): Int =
        SwingUtilities.convertPoint(target, Point(0, 0), scrollView()).y

    /** The whole point of the reveal: the target's top edge must end up inside the viewport. */
    private fun assertVisibleTop(target: JComponent) {
        val vp = (scrollComponent() as JBScrollPane).viewport
        assertTrue(
            "top=${top(target)} must be within view=${vp.viewPosition.y}..${vp.viewPosition.y + vp.extentSize.height}",
            visibleTop(target),
        )
    }

    private fun visibleTop(target: JComponent): Boolean {
        val vp = (scrollComponent() as JBScrollPane).viewport
        val top = top(target)
        return top >= vp.viewPosition.y && top < vp.viewPosition.y + vp.extentSize.height
    }

    private fun diag(target: JComponent): String {
        val vp = (scrollComponent() as JBScrollPane).viewport
        return "top=${top(target)} view=${vp.viewPosition.y} extent=${vp.extentSize.height}" +
            " content=${scrollView()?.height} bottom=${bottom(scrollBar())} value=${scrollBar().value}"
    }

    fun `test scrollPartTop returns false for an unknown message`() {
        showMessages()
        fillTranscript(3)

        assertFalse(ui.scroll.scrollPartTop("does_not_exist", "tool_1"))
    }

    /**
     * A jump disarms follow, so content arriving afterwards must not drag the transcript back to the
     * bottom and undo it.
     */
    fun `test streamed content does not undo the jump`() {
        transcript()
        val bar = scrollBar()
        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_1")!!
        park(bottom(bar))

        assertTrue(ui.scroll.scrollPartTop("asst_1", "tool_1"))
        drainScroll()
        val landed = bar.value
        assertFalse(ui.scroll.following())

        emit(ChatEventDto.MessageUpdated("ses_test", assistant("asst_tail")))
        drainScroll()

        assertEquals(landed, bar.value)
        assertFalse(ui.scroll.following())
        assertVisibleTop(part)
    }

    fun `test scrollPartTop falls back to the message for an unknown part id`() {
        transcript()
        val bar = scrollBar()
        park(0)

        // Distinct from the step-finish case above: that part exists in the model but has no
        // renderer, whereas this id is not in the model at all. Both resolve to the owning message.
        assertTrue(ui.scroll.scrollPartTop("asst_1", "does_not_exist"))
        drainScroll()

        val message = find<SessionMessageListPanel>(ui).findMessage("asst_1")!!
        assertEquals((top(message) - UiStyle.Gap.pad()).coerceIn(0, bottom(bar)), bar.value)
        assertVisibleTop(message)
    }

    /**
     * End-to-end: clicking the real header timeline (as wired in [ai.kilocode.client.session.SessionUi])
     * moves the real transcript scroll pane, not just the two halves in isolation.
     */
    fun `test clicking the header timeline scrolls the real transcript`() {
        transcript()
        val header = find<SessionHeaderPanel>(ui)
        click(header.expandButton())
        layoutAll(ui)
        val bar = scrollBar()
        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        // Park the transcript where the step is off screen, so revealing it has to move the viewport.
        park(0)
        val before = bar.value
        assertFalse("fixture must start with the step out of view: ${diag(part)}", visibleTop(part))

        // tool_2 is the 2nd timeline bar: reasoning-free assistant message with tool_1, tool_2, step_finish_1.
        pressReleaseClick(header, 1)
        drainScroll()

        assertEquals((top(part) - UiStyle.Gap.pad()).coerceIn(0, bottom(bar)), bar.value)
        assertVisibleTop(part)
        assertTrue("revealing an off-screen step must move the transcript", bar.value != before)
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
