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
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.Rectangle
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.JLayeredPane
import javax.swing.SwingUtilities

/**
 * The timeline jump's step outline — [SessionHighlightOverlay]. The outline is a transient cue, so
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

    fun `test clicking a timeline bar outlines that step, not the whole turn`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        val messages = find<SessionMessageListPanel>(ui)

        clickBar(1)

        val part = messages.findPart("asst_1", "tool_2")!!
        assertSame(part, highlight.outlined())
        assertTrue(highlight.isVisible)
        // The turn spans the whole assistant response; the outline must be the step, not that box.
        val turn = messages.findTurn("asst_1")!!
        assertFalse("the outline must not be the containing turn", turn === highlight.outlined())
    }

    /**
     * The regression this covers: turns group one user message with every following assistant
     * message, so a turn-level outline drew the same box for almost every bar in a response.
     */
    fun `test different timeline bars outline different steps`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        clickBar(0)
        val first = highlight.outlined()
        clickBar(1)
        val second = highlight.outlined()

        assertNotNull(first)
        assertNotNull(second)
        assertFalse("two different bars must not outline the same component", first === second)
    }

    fun `test outline rectangle tracks the step in overlay coordinates`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)

        clickBar(1)
        drainScroll()

        val part = find<SessionMessageListPanel>(ui).findPart("asst_1", "tool_2")!!
        val expected = SwingUtilities.convertRectangle(part, Rectangle(part.size), highlight)
        assertEquals(expected, highlight.outline())
        assertFalse("the step must have a real rect to outline", expected.isEmpty)
    }

    fun `test outline wraps the message when the step has no renderer`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        val messages = find<SessionMessageListPanel>(ui)

        // step-finish is a timeline-only marker with no view; the outline falls back to the message,
        // matching where scrollPartTop lands.
        clickBar(2)

        assertNull(messages.findPart("asst_1", "step_finish_1"))
        assertSame(messages.findMessage("asst_1"), highlight.outlined())
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
        // The clip must exclude the prompt, or a step taller than the viewport would paint its
        // outline across the input area.
        val prompt = find<PromptPanel>(ui)
        val promptRect = SwingUtilities.convertRectangle(
            prompt.parent,
            Rectangle(prompt.x, prompt.y, prompt.width, prompt.height),
            highlight,
        )
        assertFalse("clip=${highlight.clip()} prompt=$promptRect", highlight.clip().intersects(promptRect))
    }

    fun `test the guide line paints in the left padding and nothing when cleared`() {
        transcript()
        val highlight = find<SessionHighlightOverlay>(ui)
        clickBar(1)
        drainScroll()
        val rect = highlight.outline()
        val clip = highlight.clip()
        val x = highlight.guide()!!
        assertFalse(rect.isEmpty)
        // The guide belongs in the gutter: left of the step's content, not over it.
        assertTrue("guide x=$x must sit left of the step at ${rect.x}", x < rect.x)
        // And it must sit inside the step's own left inset, not out at the panel edge. Measuring
        // from the transcript panel's insets put it at the viewport edge, where it was invisible.
        val inset = JBUI.scale(SessionUiStyle.SessionLayout.INNER_HORIZONTAL)
        assertEquals("guide must be half the transcript inset in from the step", rect.x - inset / 2, x)
        assertTrue("guide x=$x must be clear of the viewport edge at ${clip.x}", x > clip.x)

        val painted = paint(highlight)
        // Sample at a height the viewport actually shows, so the clip cannot hide the line.
        val y = (rect.y + rect.height / 2).coerceIn(clip.y + 1, clip.y + clip.height - 2)
            .coerceIn(0, painted.height - 1)
        val width = SessionUiStyle.View.Highlight.width()
        val line = (x - width..x + width)
            .filter { it in 0 until painted.width }
            .any { painted.getRGB(it, y) != 0 }
        assertTrue("no guide line found at x=$x y=$y rect=$rect clip=$clip", line)
        // Nothing is drawn over the step itself: this is a margin marker, not an outline or a fill.
        val inside = (rect.x + rect.width / 2).coerceIn(0, painted.width - 1)
        assertEquals("step interior must stay unpainted at x=$inside", 0, painted.getRGB(inside, y))

        highlight.clear()
        val blank = paint(highlight)
        assertEquals(0, blank.getRGB(x.coerceIn(0, blank.width - 1), y))
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

        val message = find<SessionMessageListPanel>(ui).findMessage("asst_1")!!
        assertSame(message, highlight.outlined())
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
