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
    fun `body never reaches the rail or the window edge`() {
        val railX = 600
        val gap = 8
        val shadow = 4
        val chrome = 20 + shadow * 2

        val width = PromptRailPlacement.maxWidth(railX, gap, chrome, cap = 5000)
        val content = Dimension(width + 20, 200)
        val box = PromptRailPlacement.box(
            PromptRailPlacement.center(railX, area, gap, shadow, content, tickY = 400),
            content,
        )

        assertTrue("box $box must end before the rail at $railX", box.x + box.width <= railX)
        assertTrue("shadow must clear the rail too", box.x + box.width + shadow <= railX)
        assertTrue("box $box must stay inside the window", box.x - shadow >= 0)
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
    fun `vertical centre follows the tick but stays inside the session`() {
        val content = Dimension(200, 200)

        val middle = PromptRailPlacement.center(600, area, 8, 4, content, tickY = 400)
        assertEquals(400, middle.y)

        // Near either edge the box would hang outside the visible session, so the centre is pulled in.
        val top = PromptRailPlacement.center(600, area, 8, 4, content, tickY = 0)
        assertEquals(112, top.y)
        val bottom = PromptRailPlacement.center(600, area, 8, 4, content, tickY = 800)
        assertEquals(688, bottom.y)

        assertTrue(PromptRailPlacement.box(top, content).y >= 0)
        assertTrue(PromptRailPlacement.box(bottom, content).let { it.y + it.height } <= area.height)
    }

    @Test
    fun `a body taller than the session is centred`() {
        val content = Dimension(200, 900)

        val spot = PromptRailPlacement.center(600, area, 8, 4, content, tickY = 20)

        assertEquals(area.height / 2, spot.y)
    }

    @Test
    fun `area offset is respected`() {
        val offset = Rectangle(0, 300, 1000, 400)
        val content = Dimension(200, 200)

        val spot = PromptRailPlacement.center(600, offset, 8, 4, content, tickY = 0)

        assertEquals(412, spot.y)
        assertTrue(PromptRailPlacement.box(spot, content).y >= offset.y)
    }
}
