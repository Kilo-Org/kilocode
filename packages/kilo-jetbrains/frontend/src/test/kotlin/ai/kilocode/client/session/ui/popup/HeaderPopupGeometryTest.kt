package ai.kilocode.client.session.ui.popup

import com.intellij.openapi.ui.popup.Balloon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.awt.Rectangle

class HeaderPopupGeometryTest {
    private companion object {
        const val CHROME = 30
        const val CHROME_HEIGHT = 60
        const val GAP = 10
        const val CAP = 700
        const val CAP_HEIGHT = 450
    }

    @Test
    fun `chat on the left points right`() {
        // Tool window on the left: the editor area to its right is the roomier side.
        val spot = beside(chat = Rectangle(0, 0, 300, 1000))

        assertEquals(Balloon.Position.atRight, spot.position)
        assertEquals(300, spot.x)
    }

    @Test
    fun `chat on the right points left`() {
        val spot = beside(chat = Rectangle(1700, 0, 300, 1000))

        assertEquals(Balloon.Position.atLeft, spot.position)
        assertEquals(1700, spot.x)
    }

    @Test
    fun `side with more room wins even when both sides fit`() {
        val spot = beside(chat = Rectangle(1200, 0, 300, 1000))

        // Left room is 1200, right room is 500.
        assertEquals(Balloon.Position.atLeft, spot.position)
        assertEquals(1200, spot.x)
    }

    @Test
    fun `equal room points right`() {
        val spot = beside(chat = Rectangle(850, 0, 300, 1000))

        assertEquals(Balloon.Position.atRight, spot.position)
    }

    @Test
    fun `body is capped to the free space on the chosen side`() {
        val spot = beside(chat = Rectangle(0, 0, 1800, 1000))

        // 200 free on the right, minus chrome and gap.
        assertEquals(200 - CHROME - GAP, spot.maxWidth)
    }

    @Test
    fun `body is capped to the shared max when the side is roomy`() {
        val spot = beside(chat = Rectangle(0, 0, 300, 1000))

        assertEquals(CAP, spot.maxWidth)
    }

    @Test
    fun `a chat filling the pane yields no room rather than a negative width`() {
        val spot = beside(chat = Rectangle(0, 0, 2000, 1000))

        assertEquals(0, spot.maxWidth)
    }

    @Test
    fun `chrome is reserved so the balloon still fits its side`() {
        // The side has 400px; a body of the full 400 would overflow once the balloon adds its border,
        // pointer and shadow, and an overflowing balloon gets re-pointed above or below the chat.
        val spot = beside(chat = Rectangle(0, 0, 1600, 1000))

        assertTrue(spot.maxWidth + CHROME <= 400)
    }

    @Test
    fun `a chat with no usable room on either side still resolves to a horizontal side`() {
        val tight = HeaderPopupGeometry.beside(
            pane = Rectangle(0, 0, 2000, 1000),
            chat = Rectangle(0, 0, 1980, 1000),
            fit = fit(),
        )

        // Neither side can fit the chrome, but above/below must never be the answer.
        assertTrue(tight.position == Balloon.Position.atRight || tight.position == Balloon.Position.atLeft)
        assertEquals(0, tight.maxWidth)
    }

    @Test
    fun `height is capped to the pane minus gaps`() {
        val short = HeaderPopupGeometry.beside(
            pane = Rectangle(0, 0, 2000, 200),
            chat = Rectangle(0, 0, 300, 200),
            fit = fit(),
        )

        // 200 pane, minus both gaps and the chrome the balloon reserves vertically.
        assertEquals(200 - GAP * 2 - CHROME_HEIGHT, short.maxHeight)
    }

    @Test
    fun `pointer target keeps a tall body inside the pane`() {
        val pane = Rectangle(0, 0, 2000, 1000)

        // Row near the top: target pushed down so the centred body clears the top edge.
        assertEquals(310, HeaderPopupGeometry.centerY(pane, y = 20, height = 600, gap = GAP))
        // Row near the bottom: target pulled up.
        assertEquals(690, HeaderPopupGeometry.centerY(pane, y = 980, height = 600, gap = GAP))
        // Row with room on both sides is left alone.
        assertEquals(500, HeaderPopupGeometry.centerY(pane, y = 500, height = 600, gap = GAP))
    }

    @Test
    fun `body taller than the pane is centred instead of clamped to an empty range`() {
        val pane = Rectangle(0, 0, 2000, 400)

        assertEquals(200, HeaderPopupGeometry.centerY(pane, y = 10, height = 900, gap = GAP))
    }

    private fun beside(chat: Rectangle) = HeaderPopupGeometry.beside(
        pane = Rectangle(0, 0, 2000, 1000),
        chat = chat,
        fit = fit(),
    )

    private fun fit() = HeaderPopupFit(
        chromeWidth = CHROME,
        chromeHeight = CHROME_HEIGHT,
        gap = GAP,
        maxWidth = CAP,
        maxHeight = CAP_HEIGHT,
    )
}
