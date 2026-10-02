package ai.kilocode.client.session.ui.rail

import java.awt.Dimension
import java.awt.Rectangle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The navigator balloon has no callout, so the platform centers it on the target point and ignores the
 * requested side. These cover the centering math that keeps it off the ticks.
 */
class PromptRailPlacementTest {
    private val area = Rectangle(0, 0, 1000, 800)

    @Test
    fun `body ends exactly one gap short of the rail`() {
        val railX = 600
        val gap = 8
        val shadow = 4
        val insets = 20

        val width = PromptRailPlacement.maxWidth(railX, gap, insets + shadow * 2, cap = 5000)
        val content = Dimension(width + insets, 200)
        val box = PromptRailPlacement.box(
            PromptRailPlacement.center(railX, area, gap, content, anchorY = 400),
            content,
        )

        // The same inset the rail keeps against the scroll pane, so the two read as one column.
        assertEquals(railX - gap, box.x + box.width)
        // The shadow may fall inside that gap, but must not push the balloon outside the window, which
        // is what would make the platform nudge it back over the ticks.
        assertTrue("box $box with shadow must stay in the window", box.x - shadow >= 0)
    }

    @Test
    fun `width is capped and never negative`() {
        assertEquals(100, PromptRailPlacement.maxWidth(railX = 600, gap = 8, chrome = 20, cap = 100))
        assertEquals(564, PromptRailPlacement.maxWidth(railX = 600, gap = 8, chrome = 20, cap = 5000))
        // A rail pinned against the window edge leaves nothing to open into.
        assertEquals(0, PromptRailPlacement.maxWidth(railX = 10, gap = 8, chrome = 20, cap = 5000))
        assertEquals(0, PromptRailPlacement.maxHeight(height = 10, gap = 8, chrome = 20, cap = 5000))
    }

    @Test
    fun `centre holds the anchor but stays inside the session`() {
        val content = Dimension(200, 200)

        assertEquals(400, PromptRailPlacement.center(600, area, 8, content, anchorY = 400).y)

        // Near either edge the box would hang outside the visible session, so the centre is pulled in.
        val top = PromptRailPlacement.center(600, area, 8, content, anchorY = 0)
        val bottom = PromptRailPlacement.center(600, area, 8, content, anchorY = 800)
        assertEquals(108, top.y)
        assertEquals(692, bottom.y)
        assertTrue(PromptRailPlacement.box(top, content).y >= 0)
        assertTrue(PromptRailPlacement.box(bottom, content).let { it.y + it.height } <= area.height)
    }

    @Test
    fun `a body taller than the session is centred`() {
        val content = Dimension(200, 900)

        assertEquals(area.height / 2, PromptRailPlacement.center(600, area, 8, content, anchorY = 20).y)
    }

    @Test
    fun `area offset is respected`() {
        val offset = Rectangle(0, 300, 1000, 400)
        val content = Dimension(200, 200)

        val spot = PromptRailPlacement.center(600, offset, 8, content, anchorY = 0)

        assertEquals(408, spot.y)
        assertTrue(PromptRailPlacement.box(spot, content).y >= offset.y)
    }
}
