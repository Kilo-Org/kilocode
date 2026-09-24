package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.icons.AllIcons
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

/**
 * Base-class coverage for [Strip], the shared chrome behind [TodoStrip] and [BackgroundAgentStrip].
 * Both strips must expose identical collapsed chrome and expand/collapse mechanics, so this asserts
 * the mechanics once here rather than duplicating them in every subclass test.
 */
class StripTest : BasePlatformTestCase() {

    fun `test starts collapsed and body is not created until first expansion`() {
        val strip = TestStrip()

        assertFalse(strip.expanded())
        assertNull(strip.bodyComponent())
        assertEquals(0, strip.bodyCreations)
        assertSame(AllIcons.General.ArrowRight, strip.arrowIcon())
    }

    fun `test first expansion creates the body once and later toggles reuse it`() {
        val strip = TestStrip()

        strip.toggleNow()
        val body = strip.bodyComponent()
        assertTrue(strip.expanded())
        assertNotNull(body)
        assertEquals(1, strip.bodyCreations)
        assertSame(AllIcons.General.ArrowDown, strip.arrowIcon())

        strip.toggleNow()
        assertFalse(strip.expanded())
        assertSame(AllIcons.General.ArrowRight, strip.arrowIcon())
        // Detached, not destroyed — the instance is retained for reuse.
        assertSame(body, strip.bodyComponent())

        strip.toggleNow()
        assertTrue(strip.expanded())
        assertSame(body, strip.bodyComponent())
        assertEquals(1, strip.bodyCreations)
    }

    fun `test syncVisible hides the whole strip and collapses an expanded body`() {
        val strip = TestStrip()
        strip.toggleNow()
        assertTrue(strip.expanded())

        strip.reveal(false)

        assertFalse(strip.isVisible)
        assertFalse(strip.expanded())

        strip.reveal(true)

        assertTrue(strip.isVisible)
        assertFalse(strip.expanded())
    }

    fun `test body is hosted in a horizontal-only scroller that never widens the strip`() {
        val strip = TestStrip(span = 900)

        strip.toggleNow()
        val scroll = strip.bodyComponent() as JBScrollPane

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, scroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, scroll.verticalScrollBarPolicy)
        assertSame(strip.created, scroll.viewport.view)
        assertEquals(0, scroll.preferredSize.width)
        // The wide child keeps its own width inside the viewport so it stays scrollable.
        assertEquals(JBUI.scale(900), scroll.viewport.view.preferredSize.width)
    }

    fun `test todo strip scrolls horizontally, background-agent strip scrolls vertically`() {
        val todo = TodoStrip()
        val agents = BackgroundAgentStrip(false, { _, _ -> }, {}, {}, {})

        click(todo.rowPanel())
        click(agents.rowPanel())

        val todoScroll = todo.bodyComponent() as JBScrollPane
        val agentsScroll = agents.bodyComponent() as JBScrollPane

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, todoScroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, todoScroll.verticalScrollBarPolicy)

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, agentsScroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, agentsScroll.verticalScrollBarPolicy)
    }

    fun `test the shared summary actions cluster stays vertically centered at the east edge`() {
        val strip = TestStrip()
        val action = JLabel("action")
        strip.addAction(action)
        strip.rowComponent().setSize(400, 40)
        layoutTree(strip.rowComponent())

        val rowCenterY = strip.rowComponent().height / 2
        val actionCenterY = SwingUtilities.convertPoint(action, action.width / 2, action.height / 2, strip.rowComponent()).y

        assertTrue(Math.abs(rowCenterY - actionCenterY) <= 1)
    }

    /**
     * `Container.doLayout()` only positions direct children; it does not cascade into their own
     * layout managers the way `validate()` would. The actions cluster sits two `Align`/`Stack`
     * levels below `rowComponent()`, so reaching its actual position needs every level laid out
     * top-down, since each level's layout depends on the size its parent just assigned it.
     */
    private fun layoutTree(component: Component) {
        if (component !is JComponent) return
        component.doLayout()
        component.components.forEach { layoutTree(it) }
    }

    fun `test starts hidden until its owner reports content`() {
        val strip = TestStrip()

        assertFalse(strip.isVisible)

        strip.reveal(true)
        assertTrue(strip.isVisible)
    }

    fun `test clicking the row panel and the label both toggle`() {
        val strip = TestStrip()

        click(strip.rowPanel())
        assertTrue(strip.expanded())

        click(strip.labelComponent())
        assertFalse(strip.expanded())
    }

    fun `test clicking the full-width row toggles, not just the summary cluster`() {
        val strip = TestStrip()

        // The area beside the text is part of `row`, not the content-sized summary cluster.
        click(strip.rowComponent())
        assertTrue(strip.expanded())

        click(strip.rowComponent())
        assertFalse(strip.expanded())
    }

    fun `test every summary part shows a hand cursor`() {
        val strip = TestStrip()

        listOf(strip.rowComponent(), strip.rowPanel(), strip.labelComponent()).forEach {
            assertEquals(Cursor.HAND_CURSOR, it.cursor.type)
        }
    }

    fun `test hovering any summary part paints the transcript header hover fill`() {
        val strip = TestStrip()
        val row = strip.rowComponent().also { it.setSize(400, 24) }

        enter(strip.labelComponent())

        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, row.background.rgb)

        exit(strip.labelComponent(), 10_000, 10_000)

        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, row.background.rgb)
    }

    private fun click(component: Component) {
        component.dispatchEvent(MouseEvent(component, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false))
    }

    private fun enter(component: Component) {
        component.dispatchEvent(MouseEvent(component, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 1, 1, 0, false))
    }

    private fun exit(component: Component, x: Int, y: Int) {
        component.dispatchEvent(MouseEvent(component, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, x, y, 0, false))
    }

    /**
     * Minimal concrete [Strip]. `toggleNow`/`reveal` are declared here rather than on [Strip] so the
     * production class carries no test-only seams — a subclass may call its protected members.
     */
    private class TestStrip(private val span: Int = 0) : Strip() {
        var bodyCreations = 0
            private set
        var created: JComponent? = null
            private set

        override fun createBody(): JComponent {
            bodyCreations++
            val label = JLabel("body")
            if (span > 0) label.preferredSize = JBUI.size(span, 20)
            created = label
            return label
        }

        fun toggleNow() = toggle()

        fun reveal(visible: Boolean) = syncVisible(visible)

        fun addAction(action: Component) {
            actions.next(action)
        }
    }
}
