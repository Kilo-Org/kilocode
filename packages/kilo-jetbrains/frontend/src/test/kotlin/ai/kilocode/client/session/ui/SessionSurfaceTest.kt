package ai.kilocode.client.session.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Shape
import java.awt.geom.PathIterator
import java.awt.image.BufferedImage

@Suppress("UnstableApiUsage")
class SessionSurfaceTest : BasePlatformTestCase() {

    fun `test outline has no curved segments`() {
        assertStraight(SessionSurface.outline(765, 51))
    }

    fun `test outline covers the block`() {
        val bounds = SessionSurface.outline(120, 40).bounds2D

        assertEquals(0.0, bounds.x, 0.01)
        assertEquals(0.0, bounds.y, 0.01)
        assertEquals(120.0, bounds.width, 0.01)
        assertEquals(40.0, bounds.height, 0.01)
    }

    fun `test clipped paint keeps the center and rounds the corners`() {
        val image = BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        SessionSurface.clipped(g, 40, 40) { fill(it, 40, 40) }
        g.dispose()

        assertEquals(Color.RED.rgb, image.getRGB(20, 20))
        assertEquals("corner is clipped away", 0, image.getRGB(0, 0) ushr 24)
    }

    // Surfaces with no padding nest with shared edges (SessionSurfacePanel > code pane). Intersecting curved
    // clips there runs Java2D's Area curve math, which took 175 to 295 ms per paint at 125% scaling (#15015).
    // Check the combined clip has no curves, so the slow path cannot run, without timing anything.
    fun `test nested surfaces clip with straight segments`() {
        val image = BufferedImage(1000, 800, BufferedImage.TYPE_INT_ARGB)
        val root = image.createGraphics()
        root.scale(1.25, 1.25)
        root.translate(26, 5)
        root.setClip(0, 0, 800, 600)
        var clip: Shape? = null
        SessionSurface.clipped(root, 287, 63) { outer ->
            SessionSurface.clipped(outer, 287, 63) { inner ->
                clip = inner.clip
                fill(inner, 287, 63)
            }
        }
        root.dispose()

        assertStraight(clip!!)
        assertEquals(Color.RED.rgb, image.getRGB(26 + 179, 5 + 39))
    }

    private fun assertStraight(shape: Shape) {
        val path = shape.getPathIterator(null)
        val coords = DoubleArray(6)
        while (!path.isDone) {
            val seg = path.currentSegment(coords)
            assertTrue("clip has a curved segment (type $seg)", seg != PathIterator.SEG_QUADTO && seg != PathIterator.SEG_CUBICTO)
            path.next()
        }
    }

    private fun fill(g: Graphics, width: Int, height: Int) {
        val g2 = g as Graphics2D
        g2.color = Color.RED
        g2.fillRect(0, 0, width, height)
    }
}
