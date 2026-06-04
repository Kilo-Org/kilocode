package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import java.awt.Component
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
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

    fun `test header hover is subtler than hover outline`() {
        assertNotSameColor(SessionUiStyle.View.headerHover(), SessionUiStyle.View.hoverLine())
        assertNotSameColor(SessionUiStyle.View.headerHover(), SessionUiStyle.View.line())
    }

    fun `test primary card border follows hover color`() {
        val view = TestView(content = JLabel("body"))
        val row = view.component(0)

        enter(row)

        assertEquals(SessionUiStyle.View.hoverLine().rgb, paint(view.border).rgb)
        assertNotSameColor(SessionUiStyle.View.headerHover(), paint(view.border))
        exit(row)
        assertEquals(SessionUiStyle.View.line().rgb, paint(view.border).rgb)
    }

    private class TestView(content: JLabel, expanded: Boolean = false, expandable: Boolean = true) :
        PrimarySessionPartView(JLabel("header"), content, expanded, expandable) {

        override val contentId = "test"
        override fun update(content: Content) {}
        fun arrowVisible() = arrow.isVisible
    }

    private fun TestView.component(index: Int): Component = components[index]

    private fun enter(component: Component) = event(component, MouseEvent.MOUSE_ENTERED)

    private fun exit(component: Component) = event(component, MouseEvent.MOUSE_EXITED)

    private fun event(component: Component, id: Int) {
        component.dispatchEvent(MouseEvent(
            component,
            id,
            System.currentTimeMillis(),
            0,
            1,
            1,
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

    private fun assertNotSameColor(left: Color, right: Color) {
        assertFalse("Expected distinct colors but both were ${left.rgb}", left.rgb == right.rgb)
    }
}
