package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionDropOverlay
import ai.kilocode.client.session.ui.SessionHighlightOverlay
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartTimeDto
import java.awt.Component
import java.awt.Container
import java.awt.Rectangle
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.JLayeredPane
import javax.swing.SwingUtilities

/**
 * The timeline jump's turn outline — [SessionHighlightOverlay]. The outline is a transient cue, so
 * these tests drive it through the production entry points (a timeline click, a user scroll gesture,
 * a mouse press) rather than calling `show`/`clear` where the behavior under test is the wiring.
 */
class SessionHighlightOverlayTest : SessionUiTestBase() {

    fun `test overlay is registered in the overlay layer and never captures hit tests`() {
        val root = find<SessionRootPanel>(ui)
        val highlight = find<SessionHighlightOverlay>(ui)

        assertSame(root.overlay, highlight.parent)
        assertFalse(root.blocker.components.contains(highlight))
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
        assertFalse(highlight.contains(10, 10))
        assertFalse(highlight.contains(highlight.width / 2, highlight.height / 2))
    }

    fun `test overlay stays below the drop scrim`() {
        val root = find<SessionRootPanel>(ui)
        val highlight = find<SessionHighlightOverlay>(ui)
        val drop = find<SessionDropOverlay>(ui)

        // Lower index is painted on top; the drop scrim is forced to index 0.
        assertTrue(root.overlay.getComponentZOrder(highlight) > root.overlay.getComponentZOrder(drop))
    }

    fun `test overlay covers the full session once laid out`() {
        val root = find<SessionRootPanel>(ui)
        val highlight = find<SessionHighlightOverlay>(ui)
        ui.setSize(400, 260)
        layout()
        root.overlay.doLayout()

        assertEquals(Rectangle(0, 0, root.overlay.width, root.overlay.height), highlight.bounds)
    }

    fun `test no outline before anything is clicked`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        assertNull(highlight.outlined())
        assertFalse(highlight.isVisible)
        assertTrue(highlight.outline().isEmpty)
    }

    fun `test clicking a timeline bar outlines the turn containing that step`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        clickBar(1)

        val turn = find<SessionMessageListPanel>(ui).findTurn("asst_1")!!
        assertSame(turn, highlight.outlined())
        assertTrue(highlight.isVisible)
    }

    fun `test outline rectangle tracks the turn in overlay coordinates`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        clickBar(1)
        drainScroll()

        val turn = find<SessionMessageListPanel>(ui).findTurn("asst_1")!!
        val expected = SwingUtilities.convertRectangle(turn, Rectangle(turn.size), highlight)
        assertEquals(expected, highlight.outline())
        assertFalse("the turn must have a real rect to outline", expected.isEmpty)
    }

    fun `test outline is clipped to the transcript viewport`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        drainScroll()

        val pane = scrollComponent()
        val expected = SwingUtilities.convertRectangle(
            pane.parent,
            Rectangle(pane.x, pane.y, pane.width, pane.height),
            highlight,
        )
        assertEquals(expected, highlight.clip())
        assertFalse("the clip must be a real rect or nothing paints", highlight.clip().isEmpty)
        // The clip must exclude the prompt, or a turn taller than the viewport would paint its
        // outline across the input area.
        val prompt = find<PromptPanel>(ui)
        val promptRect = SwingUtilities.convertRectangle(
            prompt.parent,
            Rectangle(prompt.x, prompt.y, prompt.width, prompt.height),
            highlight,
        )
        assertFalse("clip=${highlight.clip()} prompt=$promptRect", highlight.clip().intersects(promptRect))
    }

    fun `test paint strokes the outline edges inside the clip and nothing when cleared`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        drainScroll()
        val rect = highlight.outline()
        val clip = highlight.clip()
        assertFalse(rect.isEmpty)

        val painted = paint(highlight)
        // Sample the left edge at a height the viewport actually shows, so the clip cannot hide it.
        val y = ((rect.y + rect.height / 2).coerceIn(clip.y + 1, clip.y + clip.height - 2))
        val stroke = (rect.x until rect.x + SessionUiStyle.View.Highlight.width())
            .any { x -> painted.getRGB(x, y) != 0 }
        assertTrue("no outline stroke found on the left edge at y=$y rect=$rect clip=$clip", stroke)
        // Well inside the turn stays untouched: this is an outline, not a fill.
        assertEquals(0, painted.getRGB(rect.x + rect.width / 2, y))

        highlight.clear()
        val blank = paint(highlight)
        assertEquals(0, blank.getRGB(rect.x + 1, y))
    }

    private fun paint(highlight: SessionHighlightOverlay): BufferedImage {
        val image = BufferedImage(
            highlight.width.coerceAtLeast(1),
            highlight.height.coerceAtLeast(1),
            BufferedImage.TYPE_INT_ARGB,
        )
        val g = image.createGraphics()
        try {
            highlight.paint(g)
        } finally {
            g.dispose()
        }
        return image
    }

    fun `test a wheel scroll clears the outline`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        assertNotNull(highlight.outlined())

        wheelNoop()

        assertNull(highlight.outlined())
        assertFalse(highlight.isVisible)
    }

    fun `test a keyboard scroll clears the outline`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        assertNotNull(highlight.outlined())

        keyScroll("scrollUp")

        assertNull(highlight.outlined())
    }

    /**
     * The jump itself scrolls the transcript over several programmatic passes. Those must not clear
     * the outline the same click just drew.
     */
    fun `test the jump's own scrolling does not clear the outline`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        val bar = scrollBar()
        setValuePassive(bar, bottom(bar))

        clickBar(1)
        drainScroll()

        assertNotNull("the jump's programmatic passes must not clear the outline", highlight.outlined())
        assertTrue(highlight.isVisible)
    }

    fun `test a mouse press in the transcript clears the outline`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        assertNotNull(highlight.outlined())

        val messages = find<SessionMessageListPanel>(ui)
        messages.dispatchEvent(
            MouseEvent(messages, MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), 0, 4, 4, 1, false, MouseEvent.BUTTON1),
        )

        assertNull(highlight.outlined())
    }

    fun `test clicking another bar re-outlines after the press clears`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        assertNotNull(highlight.outlined())

        // The press clears and the following click re-shows, so a bar-to-bar click must still end up
        // outlined. Bar 2 is the step-finish marker, whose jump falls back to the owning message.
        clickBar(2)

        val turn = find<SessionMessageListPanel>(ui).findTurn("asst_1")!!
        assertSame(turn, highlight.outlined())
        assertTrue(highlight.isVisible)
    }

    fun `test a failed jump leaves no outline`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        assertFalse(ui.scroll.scrollPartTop("does_not_exist", "nope"))

        assertNull(highlight.outlined())
    }

    private fun transcript() {
        showMessages()
        fillTranscript(6)
        emitAssistantSteps()
        ui.setSize(900, 400)
        layoutAll(ui)
        drainScroll()
        // The base layout() only reaches selected containers, so turn widths stay 0 and every
        // converted rectangle would be empty. Geometry assertions need the whole tree laid out.
        layoutAll(ui)
    }

    private fun layoutAll(comp: Component) {
        comp.doLayout()
        if (comp is Container) comp.components.forEach(::layoutAll)
    }

    /** Clicks timeline bar [index] on the expanded real header. */
    private fun clickBar(index: Int) {
        val header = find<SessionHeaderPanel>(ui)
        if (!header.isExpanded()) click(header.expandButton())
        layout()
        val timeline = header.timelinePanel()
        val x = header.timelineBarWidth() * index + 1
        val y = header.timelinePreferredSize().height - 1
        for (id in listOf(MouseEvent.MOUSE_PRESSED, MouseEvent.MOUSE_RELEASED, MouseEvent.MOUSE_CLICKED)) {
            timeline.dispatchEvent(
                MouseEvent(timeline, id, System.currentTimeMillis(), 0, x, y, 1, false, MouseEvent.BUTTON1),
            )
        }
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
