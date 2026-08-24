package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Type
import java.awt.Color
import java.awt.Font
import javax.swing.AbstractButton
import kotlin.test.Test
import kotlin.test.assertEquals
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
        assertTrue(buttons.any { it.toolTipText == KiloBundle.message("diagram.open") })
        assertTrue(buttons.any { it.toolTipText == KiloBundle.message("session.copy.hover") })
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
