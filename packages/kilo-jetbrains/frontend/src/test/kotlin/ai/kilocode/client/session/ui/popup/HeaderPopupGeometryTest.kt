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
        const val INDENT = 16
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
    fun `pointer stays on the row when the body already fits`() {
        val aim = aim(
            view = Rectangle(0, 0, 300, 1000),
            card = Rectangle(0, 400, 300, 40),
            y = 420,
            height = 300,
        )

        assertEquals(420, aim.y)
        assertEquals(150, aim.distance)
    }

    @Test
    fun `body shifts down while the pointer stays on the top row`() {
        val view = Rectangle(0, 0, 300, 1000)
        val aim = aim(view = view, card = Rectangle(0, 20, 300, 40), y = 40, height = 600)

        assertEquals(40, aim.y)
        assertEquals(GAP, aim.y - aim.distance)
    }

    @Test
    fun `body shifts up while the pointer stays on the bottom row`() {
        val view = Rectangle(0, 0, 300, 1000)
        val aim = aim(view = view, card = Rectangle(0, 940, 300, 40), y = 960, height = 600)

        assertEquals(960, aim.y)
        assertEquals(view.y + view.height - GAP, aim.y - aim.distance + 600)
    }

    @Test
    fun `pointer stays inside a collapsed card`() {
        val card = Rectangle(0, 100, 300, 30)
        val aim = aim(view = Rectangle(0, 0, 300, 1000), card = card, y = 115, height = 300)

        assertTrue(card.contains(0, aim.y))
        assertTrue(aim.distance in INDENT..300 - INDENT)
    }

    @Test
    fun `card outside the visible session falls back to the view centre`() {
        val aim = aim(
            view = Rectangle(0, 400, 300, 400),
            card = Rectangle(0, 0, 300, 40),
            y = 20,
            height = 300,
        )

        assertEquals(600, aim.y)
        assertEquals(150, aim.distance)
    }

    @Test
    fun `body taller than the session is centred instead of clamped to an empty range`() {
        val view = Rectangle(0, 0, 300, 400)
        val aim = aim(view = view, card = Rectangle(0, 0, 300, 40), y = 20, height = 900)

        assertEquals(20, aim.y)
        assertEquals(-250, aim.y - aim.distance)
        assertTrue(aim.distance in INDENT..900 - INDENT)
    }

    @Test
    fun `pointer distance stays in the platform legal window`() {
        listOf(
            aim(view = Rectangle(0, 0, 300, 200), card = Rectangle(0, 0, 300, 30), y = 15, height = 160) to 160,
            aim(view = Rectangle(0, 0, 300, 200), card = Rectangle(0, 170, 300, 30), y = 185, height = 160) to 160,
            aim(view = Rectangle(0, 0, 300, 200), card = Rectangle(0, 80, 300, 40), y = 100, height = 500) to 500,
        ).forEach { pair ->
            assertTrue(pair.first.distance in INDENT..pair.second - INDENT)
        }
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

    private fun aim(view: Rectangle, card: Rectangle, y: Int, height: Int) = HeaderPopupGeometry.aim(
        view = view,
        card = card,
        y = y,
        height = height,
        gap = GAP,
        indent = INDENT,
    )

}
