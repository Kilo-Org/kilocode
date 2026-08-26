package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JLayeredPane
import javax.swing.JPanel
import javax.swing.JRootPane

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

    fun `test expandable card header shows the hand cursor`() {
        val view = TestView(content = JLabel("body"))

        assertEquals(Cursor.HAND_CURSOR, (view.component(0) as JPanel).cursor.type)
    }

    fun `test expandable card applies the hand cursor to nested header children`() {
        val child = JLabel("plain")
        val header = JPanel(BorderLayout()).apply { add(child, BorderLayout.WEST) }
        NestedView(header)

        assertEquals(Cursor.HAND_CURSOR, child.cursor.type)
    }

    fun `test fixed non expandable card keeps the default cursor`() {
        val view = TestView(content = JLabel("body"), expandable = false)

        assertEquals(Cursor.DEFAULT_CURSOR, (view.component(0) as JPanel).cursor.type)
    }

    fun `test header hover fill differs from outline colors`() {
        assertEquals(SessionUiStyle.Colors.sessionBackground(), SessionUiStyle.View.Surface.headerBgColor())
        assertEquals(SessionUiStyle.Colors.sessionBackground(), SessionUiStyle.View.Surface.bgColor())
        assertNotSameColor(SessionUiStyle.View.Surface.headerHoverBgColor(), SessionUiStyle.View.Outline.hoverColor())
        assertNotSameColor(SessionUiStyle.View.Surface.headerHoverBgColor(), SessionUiStyle.View.Outline.brightColor())
    }

    fun `test hover only changes header background and draws no card outline`() {
        val view = TestView(content = JLabel("body"))
        val row = view.component(0) as JPanel

        assertNull("collapsed card has no outline", view.border)
        view.expand()

        view.setHovered(true)

        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)
        assertNull("expanded card draws no outline", view.border)
        view.setHovered(false)
        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, row.background.rgb)
        assertNull("expanded card draws no outline", view.border)
    }

    fun `test expanded body is separated from header by the standard gap`() {
        val content = JLabel("body")
        val view = TestView(content = content, expanded = true)

        val layout = view.layout as BorderLayout
        assertEquals(SessionUiStyle.View.contentGap(), layout.vgap)
        assertSame(view, content.parent)
    }

    fun `test collapsed card hover fill is rounded`() {
        val view = TestView(content = JLabel("body"))
        val row = view.component(0) as JPanel
        row.setSize(40, 40)
        view.setHovered(true)

        val image = paintRow(row)
        val hover = SessionUiStyle.View.Surface.headerHoverBgColor().rgb

        assertEquals("center is filled with the hover color", hover, image.getRGB(20, 2))
        assertEquals("rounded corner is transparent", 0, image.getRGB(0, 0) ushr 24)
    }

    fun `test expanded card hover fill stays rounded`() {
        val view = TestView(content = JLabel("body"))
        view.expand()
        val row = view.component(0) as JPanel
        row.setSize(40, 40)
        view.setHovered(true)

        val image = paintRow(row)
        val hover = SessionUiStyle.View.Surface.headerHoverBgColor().rgb

        assertEquals("center is filled with the hover color", hover, image.getRGB(20, 2))
        assertEquals("expanded header keeps the rounded corner transparent", 0, image.getRGB(0, 0) ushr 24)
    }

    private fun paintRow(row: JPanel): BufferedImage {
        val image = BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        row.paint(graphics)
        graphics.dispose()
        return image
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

    fun `test hover survives an exit that stays on the row`() {
        val view = NestedView(JLabel("link"))
        val row = view.component(0) as JPanel
        pane(view)

        enter(row)
        // Swing reports an exit for every nested crossing; one that lands back on the row is not a
        // leave, so the fill must stay.
        exit(row, 5, 5)

        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)
    }

    fun `test hover clears when an overlay covers the row under the pointer`() {
        val view = NestedView(JLabel("link"))
        val row = view.component(0) as JPanel
        val pane = pane(view)
        enter(row)
        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)

        // A banner painted above the transcript owns the pointer even while it sits inside the row's
        // bounds, so the row must not stay lit underneath it.
        pane.add(JPanel().apply { setBounds(0, 0, 200, 40) }, JLayeredPane.PALETTE_LAYER)
        exit(row, 5, 5)

        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, row.background.rgb)
    }

    private fun pane(view: AbstractSessionPartView): JLayeredPane {
        val root = JRootPane()
        root.setSize(200, 40)
        root.contentPane.add(view)
        view.setSize(200, 40)
        view.doLayout()
        root.doLayout()
        root.contentPane.doLayout()
        return root.layeredPane
    }

    fun `test clicking a nested header child toggles the card`() {
        val child = JLabel("plain")
        val header = JPanel(BorderLayout()).apply { add(child, BorderLayout.WEST) }
        val view = NestedView(header)
        view.setSize(200, 40)
        view.doLayout()

        assertFalse(view.isExpanded())
        click(child)
        assertTrue("Clicking anywhere on the header toggles the card", view.isExpanded())
        click(child)
        assertFalse(view.isExpanded())
    }

    fun `test clicking an interactive header child runs its action without toggling`() {
        var clicks = 0
        val child = JLabel("link").apply {
            addMouseListener(object : java.awt.event.MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) { clicks++ }
            })
        }
        val header = JPanel(BorderLayout()).apply { add(child, BorderLayout.WEST) }
        val view = NestedView(header)
        view.setSize(200, 40)
        view.doLayout()

        click(child)

        assertEquals("The child's own action runs", 1, clicks)
        assertFalse("A control with its own click handler must not also toggle", view.isExpanded())
    }

    private open class TestView(content: JLabel, expanded: Boolean = false, expandable: Boolean = true) :
        AbstractSessionPartView(JLabel("header"), content, expanded, expandable) {

        override val contentId = "test"
        override fun update(content: Content) {}
        fun arrowVisible() = arrow.isVisible
        fun arrowIcon(): Icon = arrow.icon
    }

    private class NestedView(header: JComponent) : AbstractSessionPartView(header, JLabel("body")) {
        override val contentId = "nested"
        override fun update(content: Content) {}
    }

    private fun AbstractSessionPartView.component(index: Int): Component = components[index]

    private fun click(component: Component) = event(component, MouseEvent.MOUSE_CLICKED, 1, 1)

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

    private fun assertNotSameColor(left: Color, right: Color) {
        assertFalse("Expected distinct colors but both were ${left.rgb}", left.rgb == right.rgb)
    }
}
