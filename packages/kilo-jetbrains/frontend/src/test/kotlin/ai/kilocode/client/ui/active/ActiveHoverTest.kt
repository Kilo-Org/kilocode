package ai.kilocode.client.ui.active

import java.awt.Point
import java.awt.Rectangle
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame

class ActiveHoverTest {
    private var builds = 0

    private fun regions(vararg hits: ActiveHit): List<ActiveHit> {
        builds++
        return hits.toList()
    }

    private fun hit(id: String, x: Int) =
        ActiveHit(id, Rectangle(x, 0, 10, 10), true, 0, null, null)

    @Test
    fun `moving between buttons of one row hovers only the one under the pointer`() {
        val hover = ActiveHover()
        val first = hit("first", 0)
        val second = hit("second", 20)

        hover.move(0, false, Point(5, 5)) { regions(first, second) }
        assertEquals("first", hover.cell)

        hover.move(0, false, Point(25, 5)) { regions(first, second) }
        assertEquals("second", hover.cell)
        assertEquals(1, builds)
    }

    @Test
    fun `the row body clears the button without changing rows`() {
        val hover = ActiveHover()
        hover.move(0, false, Point(5, 5)) { regions(hit("first", 0)) }
        assertEquals("first", hover.cell)

        hover.move(0, false, Point(50, 5)) { regions(hit("first", 0)) }

        assertNull(hover.cell)
        assertEquals(0, hover.row)
    }

    @Test
    fun `entering another row replaces the previous cell`() {
        val hover = ActiveHover()
        val target = hit("badge", 0)
        hover.move(0, false, Point(5, 5)) { regions(target) }

        hover.move(1, false, Point(5, 5)) { regions(target) }

        assertEquals(1, hover.row)
        assertEquals("badge", hover.cell)
        assertEquals(2, builds)
    }

    @Test
    fun `a selection change rebuilds the cached regions`() {
        val hover = ActiveHover()
        hover.move(0, false, Point(5, 5)) { regions(hit("badge", 0)) }

        hover.move(0, true, Point(5, 5)) { regions(hit("badge", 0)) }

        assertEquals(2, builds)
    }

    @Test
    fun `invalidating forces the next move to rebuild the regions`() {
        val hover = ActiveHover()
        hover.move(0, false, Point(5, 5)) { regions(hit("badge", 0)) }

        hover.invalidate()
        hover.move(0, false, Point(5, 5)) { regions(hit("badge", 0)) }

        assertEquals(2, builds)
    }

    @Test
    fun `clearing drops the row and cell`() {
        val hover = ActiveHover()
        hover.move(0, false, Point(5, 5)) { regions(hit("badge", 0)) }

        hover.clear()

        assertEquals(-1, hover.row)
        assertNull(hover.cell)
    }

    @Test
    fun `the enabled hit under the pointer is answered`() {
        val hover = ActiveHover()
        val disabled = ActiveHit("disabled", Rectangle(0, 0, 10, 10), false, 0, null, null)
        val enabled = ActiveHit("enabled", Rectangle(20, 0, 10, 10), true, 0, null, null)

        val target = hover.move(0, false, Point(25, 5)) { regions(disabled, enabled) }

        assertSame(enabled, target)
        assertEquals("enabled", hover.cell)
    }
}
