package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Type
import java.awt.Color
import java.awt.Font
import java.awt.image.BufferedImage
import javax.swing.AbstractButton
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class DiagramPanelTest {
    @Test
    fun `test panel fits width and caps height`() {
        val panel = DiagramPanel(palette())
        panel.setSize(100, 1)
        panel.art(scene(300.0, 100.0))

        assertTrue(panel.preferredSize.height < 100)
        assertEquals(0, panel.preferredSize.width)

        panel.setSize(2_000, 1)
        panel.art(scene(100.0, 2_000.0))

        assertTrue(panel.preferredSize.height <= 520)
    }

    @Test
    fun `test block copies fence text and offers copy plus open in editor`() {
        val block = DiagramBlock()
        block.text = { "flowchart TD" }

        val buttons = buttons(block.copyToolbar)

        assertEquals("flowchart TD", block.copyText())
        assertEquals(2, buttons.size)
        assertTrue(block.copyCorner)
        assertTrue(buttons.any { it.toolTipText == KiloBundle.message("diagram.open") })
        assertTrue(buttons.any { it.toolTipText == KiloBundle.message("session.copy.hover") })
        assertTrue(buttons.any { it.icon === SessionViewIcons.openDiff })
    }

    @Test
    fun `test a normal diagram is copied at the crisp shot scale`() {
        val image = diagramImage(scene(100.0, 50.0), palette(), Color.WHITE)

        assertNotNull(image)
        assertEquals(100 * 2 + 16 * 2 * 2, image.width)
        assertEquals(50 * 2 + 16 * 2 * 2, image.height)
    }

    /**
     * The engine caps the model, not the geometry, so a legal diagram can still span tens of thousands
     * of units. Copying it must downscale rather than ask for a multi-gigabyte raster on the EDT.
     */
    @Test
    fun `test a huge diagram is copied downscaled instead of allocating gigabytes`() {
        val image = diagramImage(scene(120_000.0, 90_000.0), palette(), Color.WHITE)

        assertNotNull(image)
        assertTrue(image.width <= 8_000, "width ${image.width}")
        assertTrue(image.height <= 8_000, "height ${image.height}")
        assertTrue(image.width.toLong() * image.height <= 9_000_000L, "pixels ${image.width * image.height}")
        assertTrue(image.width > 0 && image.height > 0)
    }

    @Test
    fun `test painting a scene reports that it drew`() {
        val target = BufferedImage(80, 80, BufferedImage.TYPE_INT_RGB)
        val g = target.createGraphics()

        try {
            assertTrue(paintDiagram(g, scene(40.0, 20.0), palette(), 1.0, 4, 4))
        } finally {
            g.dispose()
        }
    }

    private fun buttons(root: java.awt.Container): List<AbstractButton> {
        val out = mutableListOf<AbstractButton>()
        for (comp in root.components) {
            if (comp is AbstractButton) out.add(comp)
            if (comp is java.awt.Container) out.addAll(buttons(comp))
        }
        return out
    }

    private fun scene(w: Double, h: Double) = Scene(
        Type.Flowchart,
        listOf(Mark.Box(Rect(0.0, 0.0, w, h), 4.0, Role.Surface, Role.Border)),
        Size(w, h),
    )

    private fun palette() = Palette(
        surface = Color.WHITE,
        border = Color.BLACK,
        text = Color.BLACK,
        muted = Color.GRAY,
        accent = Color.BLUE,
        note = Color.YELLOW,
        cluster = Color.LIGHT_GRAY,
        line = Color.DARK_GRAY,
        font = Font(Font.SANS_SERIF, Font.PLAIN, 12),
        bold = Font(Font.SANS_SERIF, Font.BOLD, 12),
    )
}
