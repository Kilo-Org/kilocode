package ai.kilocode.client.session.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.geom.PathIterator
import java.awt.image.BufferedImage

@Suppress("UnstableApiUsage")
class SessionSurfaceTest : BasePlatformTestCase() {

    fun `test outline has no curved segments`() {
        val path = SessionSurface.outline(765, 51).getPathIterator(null)
        val coords = DoubleArray(6)
        while (!path.isDone) {
            val seg = path.currentSegment(coords)
            assertTrue("segment $seg is a straight line", seg != PathIterator.SEG_QUADTO && seg != PathIterator.SEG_CUBICTO)
            path.next()
        }
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

    // Surfaces with no padding nest with shared edges (SessionSurfacePanel > code pane). At 125% display
    // scaling this geometry took 175 to 295 ms per paint with curved clips (#15015).
    fun `test nested surfaces with shared edges paint quickly`() {
        val image = BufferedImage(1000, 800, BufferedImage.TYPE_INT_ARGB)
        val root = image.createGraphics()
        root.scale(1.25, 1.25)
        root.translate(26, 5)
        root.setClip(0, 0, 800, 600)
        val start = System.nanoTime()
        repeat(10) { nest(root, 287, 63, 2) }
        val ms = (System.nanoTime() - start) / 1_000_000
        root.dispose()

        assertTrue("10 nested paints took $ms ms", ms < 1_000)
    }

    private fun nest(g: Graphics, width: Int, height: Int, depth: Int) {
        if (depth == 0) return fill(g, width, height)
        SessionSurface.clipped(g, width, height) { nest(it, width, height, depth - 1) }
    }

    private fun fill(g: Graphics, width: Int, height: Int) {
        val g2 = g as Graphics2D
        g2.color = Color.RED
        g2.fillRect(0, 0, width, height)
    }
}
