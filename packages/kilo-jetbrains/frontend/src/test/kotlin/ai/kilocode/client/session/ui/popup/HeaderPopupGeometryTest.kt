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
    fun `card on the left points right`() {
        // Tool window on the left: the editor area to its right is the roomier side.
        val spot = beside(card = Rectangle(0, 0, 300, 40))

        assertEquals(Balloon.Position.atRight, spot.position)
        assertEquals(300, spot.x)
    }

    @Test
    fun `card on the right points left`() {
        val spot = beside(card = Rectangle(1700, 0, 300, 40))

        assertEquals(Balloon.Position.atLeft, spot.position)
        assertEquals(1700, spot.x)
    }

    @Test
    fun `the pointer lands on the card edge, not the session edge`() {
        // Left-docked chat: cards are inset from the session, so the balloon hugs the card at 760
        // rather than docking to the session edge at 800.
        val spot = HeaderPopupGeometry.beside(
            pane = Rectangle(0, 0, 2000, 1000),
            card = Rectangle(60, 300, 700, 40),
            view = Rectangle(0, 0, 800, 1000),
            fit = fit(),
        )

        assertEquals(Balloon.Position.atRight, spot.position)
        assertEquals(760, spot.x)
    }

    @Test
    fun `side with more room wins even when both sides fit`() {
        val spot = beside(card = Rectangle(1200, 0, 300, 40))

        // Left room is 1200, right room is 500.
        assertEquals(Balloon.Position.atLeft, spot.position)
        assertEquals(1200, spot.x)
    }

    @Test
    fun `equal room points right`() {
        val spot = beside(card = Rectangle(850, 0, 300, 40))

        assertEquals(Balloon.Position.atRight, spot.position)
    }

    @Test
    fun `body is capped to the free space on the chosen side`() {
        val spot = beside(card = Rectangle(0, 0, 1800, 40))

        // 200 free on the right, minus chrome and gap.
        assertEquals(200 - CHROME - GAP, spot.maxWidth)
    }

    @Test
    fun `body is capped to the shared max when the side is roomy`() {
        val spot = beside(card = Rectangle(0, 0, 300, 40))

        assertEquals(CAP, spot.maxWidth)
    }

    @Test
    fun `a card filling the pane yields no room rather than a negative width`() {
        val spot = beside(card = Rectangle(0, 0, 2000, 40))

        assertEquals(0, spot.maxWidth)
    }

    @Test
    fun `chrome is reserved so the balloon still fits its side`() {
        // The side has 400px; a body of the full 400 would overflow once the balloon adds its border,
        // pointer and shadow, and an overflowing balloon gets re-pointed above or below the card.
        val spot = beside(card = Rectangle(0, 0, 1600, 40))

        assertTrue(spot.maxWidth + CHROME <= 400)
    }

    @Test
    fun `a card with no usable room on either side still resolves to a horizontal side`() {
        val tight = beside(card = Rectangle(0, 0, 1980, 40))

        // Neither side can fit the chrome, but above/below must never be the answer.
        assertTrue(tight.position == Balloon.Position.atRight || tight.position == Balloon.Position.atLeft)
        assertEquals(0, tight.maxWidth)
    }

    @Test
    fun `height is capped to the session minus gaps`() {
        val short = HeaderPopupGeometry.beside(
            pane = Rectangle(0, 0, 2000, 200),
            card = Rectangle(0, 0, 300, 40),
            view = Rectangle(0, 0, 300, 200),
            fit = fit(),
        )

        // 200 session, minus both gaps and the chrome the balloon reserves vertically.
        assertEquals(200 - GAP * 2 - CHROME_HEIGHT, short.maxHeight)
    }

    @Test
    fun `height follows a short session inside a tall pane`() {
        // Session in an editor tab or a short tool window: the window has room the session does not.
        val spot = HeaderPopupGeometry.beside(
            pane = Rectangle(0, 0, 2000, 1000),
            card = Rectangle(0, 100, 300, 40),
            view = Rectangle(0, 100, 300, 300),
            fit = fit(),
        )

        assertEquals(300 - GAP * 2 - CHROME_HEIGHT, spot.maxHeight)
    }

    @Test
    fun `height follows the session even when the card is a collapsed header`() {
        val spot = beside(card = Rectangle(0, 0, 300, 30))

        assertEquals(CAP_HEIGHT, spot.maxHeight)
    }

    @Test
    fun `pointer target keeps the body inside an offset session`() {
        val view = Rectangle(0, 400, 300, 400)

        // Rows above and below the session are pulled back into it.
        assertEquals(560, HeaderPopupGeometry.centerY(view, y = 0, height = 300, gap = GAP))
        assertEquals(640, HeaderPopupGeometry.centerY(view, y = 1000, height = 300, gap = GAP))
    }

    @Test
    fun `pointer target keeps a tall body inside the session`() {
        val view = Rectangle(0, 0, 300, 1000)

        // Row near the top: target pushed down so the centred body clears the top edge.
        assertEquals(310, HeaderPopupGeometry.centerY(view, y = 20, height = 600, gap = GAP))
        // Row near the bottom: target pulled up.
        assertEquals(690, HeaderPopupGeometry.centerY(view, y = 980, height = 600, gap = GAP))
        // Row with room on both sides is left alone.
        assertEquals(500, HeaderPopupGeometry.centerY(view, y = 500, height = 600, gap = GAP))
    }

    @Test
    fun `body taller than the session is centred instead of clamped to an empty range`() {
        val view = Rectangle(0, 0, 300, 400)

        assertEquals(200, HeaderPopupGeometry.centerY(view, y = 10, height = 900, gap = GAP))
    }

    private fun beside(card: Rectangle) = HeaderPopupGeometry.beside(
        pane = Rectangle(0, 0, 2000, 1000),
        card = card,
        view = Rectangle(0, 0, 2000, 1000),
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
