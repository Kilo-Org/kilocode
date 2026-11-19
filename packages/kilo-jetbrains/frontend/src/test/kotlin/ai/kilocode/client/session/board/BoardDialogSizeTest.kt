package ai.kilocode.client.session.board

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Sizing rules for the board dialog. Kept as pure functions because a headless test has no IDE
 * frame to measure — `WindowManager.getFrame(project)` is null there, so asserting this through the
 * real dialog would silently pass without checking anything.
 */
class BoardDialogSizeTest {

    @Test
    fun `content narrower than a third of the frame is widened to it`() {
        assertEquals(400, boardWidth(content = 150, frame = 1200))
    }

    @Test
    fun `content wider than the frame is capped at the frame`() {
        assertEquals(1200, boardWidth(content = 3000, frame = 1200))
    }

    @Test
    fun `content inside the range packs to its own width`() {
        assertEquals(700, boardWidth(content = 700, frame = 1200))
    }

    @Test
    fun `boundaries are inclusive`() {
        assertEquals(400, boardWidth(content = 400, frame = 1200))
        assertEquals(1200, boardWidth(content = 1200, frame = 1200))
    }

    @Test
    fun `no measurable frame leaves the content width alone`() {
        assertEquals(150, boardWidth(content = 150, frame = 0))
        assertEquals(150, boardWidth(content = 150, frame = -1))
    }

    @Test
    fun `wrap width tracks a third of the frame and stays inside it`() {
        val wrap = boardWrap(frame = 1200)
        assertTrue(wrap in 1..400, "wrap $wrap should sit inside frame/3 (400)")
    }

    @Test
    fun `wrap width falls back without a frame and is always positive`() {
        assertTrue(boardWrap(frame = 0) > 0)
        assertTrue(boardWrap(frame = 1) > 0)
        assertTrue(boardWrap(frame = -1) > 0)
    }
}
