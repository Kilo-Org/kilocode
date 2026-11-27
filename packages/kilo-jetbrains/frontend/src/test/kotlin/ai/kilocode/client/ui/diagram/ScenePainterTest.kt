package ai.kilocode.client.ui.diagram

import java.awt.Color
import java.awt.Font
import java.awt.image.BufferedImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ScenePainterTest {
    @Test
    fun `test painter renders all mark variants`() {
        val scene = Scene(
            Type.Flowchart,
            listOf(
                Mark.Box(Rect(10.0, 10.0, 30.0, 20.0), 6.0, Role.Surface, Role.Border),
                Mark.Oval(Rect(50.0, 10.0, 24.0, 20.0), Role.Note, Role.Line),
                Mark.Poly(listOf(Pt(15.0, 50.0), Pt(35.0, 45.0), Pt(45.0, 65.0)), Role.Cluster, Role.Border),
                Mark.Edge(listOf(Pt(70.0, 50.0), Pt(110.0, 50.0)), Role.Accent, dash = true, thick = true, head = Head.Arrow),
                Mark.Group("g", listOf(Mark.Text("T", Pt(90.0, 25.0), Anchor.Center, Role.Text, bold = true))),
                Mark.Sector(Pt(115.0, 65.0), 12.0, 90.0, -270.0, null, Role.Border, tone = 0),
            ),
            Size(130.0, 80.0),
        )
        val img = BufferedImage(140, 90, BufferedImage.TYPE_INT_ARGB)

        ScenePainter.paint(img.createGraphics(), scene, palette())

        assertNotEquals(0, img.rgb(20, 20))
        assertNotEquals(0, img.rgb(60, 20))
        assertNotEquals(0, img.rgb(25, 55))
        assertNotEquals(0, img.rgb(105, 50))
        assertNotEquals(0, img.rgb(112, 70))
        assertTrue(nonEmpty(img) > 300)
    }

    /** Every head variant paints something at the arrow tip without throwing. */
    @Test
    fun `test painter renders every head variant`() {
        for (head in Head.entries.filter { it != Head.None }) {
            val scene = Scene(
                Type.Class,
                listOf(Mark.Edge(listOf(Pt(10.0, 20.0), Pt(50.0, 20.0)), Role.Line, head = head)),
                Size(70.0, 40.0),
            )
            val img = BufferedImage(70, 40, BufferedImage.TYPE_INT_ARGB)

            ScenePainter.paint(img.createGraphics(), scene, palette())

            assertTrue(nonEmpty(img) > 10, "head $head painted nothing")
        }
    }

    /** Soft tones must fill translucently so overlapping chart bands stay readable. */
    @Test
    fun `test soft tone fills are translucent`() {
        val scene = Scene(
            Type.Radar,
            listOf(Mark.Poly(listOf(Pt(5.0, 5.0), Pt(60.0, 5.0), Pt(60.0, 35.0), Pt(5.0, 35.0)), null, null, tone = 0, soft = true)),
            Size(70.0, 40.0),
        )
        val img = BufferedImage(70, 40, BufferedImage.TYPE_INT_ARGB)

        ScenePainter.paint(img.createGraphics(), scene, palette())

        val alpha = img.rgb(30, 20)
        assertTrue(alpha in 1..254, "expected a translucent fill but alpha was $alpha")
    }

    @Test
    fun `test registry chooses scene painter`() {
        val scene = Scene(Type.Sequence, emptyList(), Size(1.0, 2.0))

        assertEquals(ScenePainter, Painters.of(scene))
        assertEquals(Size(1.0, 2.0), Painters.of(scene).size(scene))
    }

    private fun palette() = Palette(
        surface = Color(0xEE, 0xEE, 0xEE),
        border = Color(0x11, 0x11, 0x11),
        text = Color(0x22, 0x22, 0x22),
        muted = Color(0x77, 0x77, 0x77),
        accent = Color(0x00, 0x66, 0xCC),
        note = Color(0xFF, 0xF5, 0xCC),
        cluster = Color(0xDD, 0xEE, 0xFF),
        line = Color(0x33, 0x33, 0x33),
        font = Font(Font.SANS_SERIF, Font.PLAIN, 12),
        bold = Font(Font.SANS_SERIF, Font.BOLD, 12),
    )

    private fun BufferedImage.rgb(x: Int, y: Int) = getRGB(x, y) ushr 24

    private fun nonEmpty(img: BufferedImage): Int {
        var count = 0
        for (x in 0 until img.width) {
            for (y in 0 until img.height) if (img.rgb(x, y) != 0) count++
        }
        return count
    }
}
