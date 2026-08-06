package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle.View.Header
import ai.kilocode.client.ui.DiffBars
import ai.kilocode.client.ui.HoverIcon
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import javax.swing.SwingUtilities
import kotlin.math.abs

class PartHeaderTest : BasePlatformTestCase() {
    fun `test labels and fixed controls are vertically centered`() {
        val title = JBLabel("Edit")
        val icon = HoverIcon()
        val bars = DiffBars(3, 1)
        val header = PartHeader().apply {
            left(title, PartHeader.centered(icon))
            right(PartHeader.centered(bars))
        }

        sized(header, 400)

        val mid = header.height / 2
        assertNear(mid, centerY(header, title))
        assertNear(mid, centerY(header, icon))
        assertNear(mid, centerY(header, bars))
    }

    fun `test leading uses icon gap and universal gap between elements`() {
        val glyph = JBLabel("g")
        val title = JBLabel("Edit")
        val extra = JBLabel("x")
        val header = PartHeader().apply {
            leading(glyph)
            left(title, extra)
        }

        sized(header, 400)

        assertEquals(Header.icon(), title.x - (glyph.x + glyph.width))
        assertEquals(Header.gap(), extra.x - (title.x + title.width))
    }

    fun `test title gap separates the title from following elements`() {
        val glyph = JBLabel("g")
        val title = JBLabel("Edit")
        val name = JBLabel("main.tf")
        val extra = JBLabel("x")
        val header = PartHeader().apply {
            leading(glyph)
            left(title)
            titleGap()
            left(name, extra)
        }

        sized(header, 400)

        assertEquals(Header.title(), name.x - (title.x + title.width))
        assertEquals(Header.gap(), extra.x - (name.x + name.width))
        assertTrue(Header.title() > Header.gap())
    }

    fun `test right group hugs the trailing edge`() {
        val bars = DiffBars(1, 1)
        val header = PartHeader().apply {
            left(JBLabel("Modified"))
            right(PartHeader.centered(bars))
        }

        sized(header, 400)

        val edge = SwingUtilities.convertPoint(bars.parent, bars.x + bars.width, 0, header).x
        assertTrue("right group should reach the trailing edge, was $edge of ${header.width}", edge >= header.width - 2)
    }

    fun `test fill middle absorbs width and clips long content`() {
        val path = JBLabel("a".repeat(400))
        val header = PartHeader().apply {
            left(JBLabel("Edit"))
            fill(path)
            right(JBLabel("done"))
        }

        sized(header, 240)

        assertTrue("fill child should not exceed header width", path.width <= header.width)
    }

    private fun sized(header: PartHeader, width: Int) {
        header.size = Dimension(width, header.preferredSize.height)
        layout(header)
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
    }

    private fun centerY(header: PartHeader, comp: Component): Int =
        SwingUtilities.convertPoint(comp.parent, comp.x + comp.width / 2, comp.y + comp.height / 2, header).y

    private fun assertNear(expected: Int, actual: Int) {
        assertTrue("expected ~$expected but was $actual", abs(expected - actual) <= 1)
    }
}
