package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.border.Border

@Suppress("UnstableApiUsage")
class AbstractSessionPartViewTest : BasePlatformTestCase() {

    fun `test collapsed by default`() {
        val content = JLabel("body")
        val view = TestView(content = content)

        assertFalse(view.isExpanded())
        assertNull(content.parent)
    }

    fun `test expanded when requested`() {
        val content = JLabel("body")
        val view = TestView(content = content, expanded = true)

        assertTrue(view.isExpanded())
        assertSame(view, content.parent)
    }

    fun `test toggle reuses content component`() {
        val content = JLabel("body")
        val view = TestView(content = content)

        view.syncExpandable(true)
        view.toggle()
        assertSame(view, content.parent)
        view.toggle()
        assertNull(content.parent)
        view.toggle()
        assertSame(view, content.parent)
    }

    fun `test toggle uses right and down chevron icons`() {
        val view = TestView(content = JLabel("body"))

        assertSame(SessionViewIcons.chevronCollapsed, view.arrowIcon())
        assertSame(SessionViewIcons.chevronRight, view.arrowIcon())
        val closed = view.arrowIcon()

        view.toggle()

        assertSame(SessionViewIcons.chevronExpanded, view.arrowIcon())
        assertSame(SessionViewIcons.chevronDown, view.arrowIcon())
        assertNotSame(closed, view.arrowIcon())
        assertEquals(closed.iconWidth, view.arrowIcon().iconWidth)
        assertEquals(closed.iconHeight, view.arrowIcon().iconHeight)
    }

    fun `test non expandable hides content`() {
        val content = JLabel("body")
        val view = TestView(content = content, expanded = true)

        view.syncExpandable(false)

        assertFalse(view.isExpanded())
        assertNull(content.parent)
    }

    fun `test fixed non expandable ignores expansion`() {
        val content = JLabel("body")
        val view = TestView(content = content, expanded = true, expandable = false)

        assertFalse(view.isExpanded())
        assertFalse(view.arrowVisible())
        assertNull(content.parent)

        view.syncExpandable(true)
        view.toggle()

        assertFalse(view.isExpanded())
        assertFalse(view.arrowVisible())
        assertNull(content.parent)
    }

    fun `test header hover fill differs from outline colors`() {
        assertEquals(SessionUiStyle.Colors.sessionBackground(), SessionUiStyle.View.Surface.headerBgColor())
        assertEquals(SessionUiStyle.Colors.sessionBackground(), SessionUiStyle.View.Surface.bgColor())
        assertNotSameColor(SessionUiStyle.View.Surface.headerHoverBgColor(), SessionUiStyle.View.Outline.hoverColor())
        assertNotSameColor(SessionUiStyle.View.Surface.headerHoverBgColor(), SessionUiStyle.View.Outline.brightColor())
    }

    fun `test primary card hover only changes header background`() {
        val view = TestView(content = JLabel("body"))
        val row = view.component(0) as JPanel

        assertEquals(0, paint(view.border).alpha)
        view.expand()

        view.setHovered(true)

        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)
        assertLine(view.border)
        view.setHovered(false)
        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, row.background.rgb)
        assertLine(view.border)
    }

    fun `test hover tracks nested header child and clears on leave`() {
        val child = JLabel("link")
        val header = JPanel(BorderLayout()).apply { add(child, BorderLayout.WEST) }
        val view = NestedView(header)
        val row = view.component(0) as JPanel
        view.setSize(200, 40)
        view.doLayout()

        // A nested child that is not click-bound (e.g. a file link) must still report hover.
        enter(child)
        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)

        // Leaving the row through that nested child clears the fill instead of leaving it stuck.
        exit(child, 10_000, 10_000)
        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, row.background.rgb)
    }

    private open class TestView(content: JLabel, expanded: Boolean = false, expandable: Boolean = true) :
        PrimarySessionPartView(JLabel("header"), content, expanded, expandable) {

        override val contentId = "test"
        override fun update(content: Content) {}
        fun arrowVisible() = arrow.isVisible
        fun arrowIcon(): Icon = arrow.icon
    }

    private class NestedView(header: JComponent) : PrimarySessionPartView(header, JLabel("body")) {
        override val contentId = "nested"
        override fun update(content: Content) {}
    }

    private fun PrimarySessionPartView.component(index: Int): Component = components[index]

    private fun enter(component: Component) = event(component, MouseEvent.MOUSE_ENTERED, 1, 1)

    private fun exit(component: Component, x: Int = 1, y: Int = 1) = event(component, MouseEvent.MOUSE_EXITED, x, y)

    private fun event(component: Component, id: Int, x: Int, y: Int) {
        component.dispatchEvent(MouseEvent(
            component,
            id,
            System.currentTimeMillis(),
            0,
            x,
            y,
            0,
            false,
        ))
    }

    private fun paint(border: Border): Color {
        val image = BufferedImage(3, 3, BufferedImage.TYPE_INT_ARGB)
        val panel = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(panel, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        return Color(image.getRGB(0, 0), true)
    }

    private fun assertLine(border: Border) {
        val image = BufferedImage(5, 5, BufferedImage.TYPE_INT_ARGB)
        val panel = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(panel, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        val rgb = SessionUiStyle.View.Outline.color().rgb
        assertEquals(rgb, Color(image.getRGB(2, 0), true).rgb)
        assertEquals(rgb, Color(image.getRGB(0, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(4, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(2, 4), true).rgb)
    }

    private fun assertNotSameColor(left: Color, right: Color) {
        assertFalse("Expected distinct colors but both were ${left.rgb}", left.rgb == right.rgb)
    }
}
