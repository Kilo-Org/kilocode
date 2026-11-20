package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Dimension

class ActiveListAnchorTest : BasePlatformTestCase() {

    /**
     * The balloon opens below the anchor, so the callout must sit on the row's bottom edge at its
     * horizontal middle. A vertically centered anchor hides the callout under the balloon and covers
     * the row it is renaming.
     */
    fun `test row anchor points at the middle of the row from its bottom edge`() {
        val view = laidOut()

        val anchor = view.point("b")

        val bounds = view.list.getCellBounds(1, 1)!!
        assertTrue("a zero-width row would make the centering assertion vacuous", bounds.width > 0)
        assertTrue("a zero-height row would make the edge assertion vacuous", bounds.height > 0)
        assertSame(view.list, anchor.component)
        assertEquals(bounds.x + bounds.width / 2, anchor.point.x)
        assertEquals(bounds.y + bounds.height, anchor.point.y)
    }

    fun `test anchor for an unknown key falls back to the list origin`() {
        val view = laidOut()

        val anchor = view.point("missing")

        assertSame(view.list, anchor.component)
        assertEquals(0, anchor.point.x)
        assertEquals(0, anchor.point.y)
    }

    /**
     * Sizes the list itself rather than a scroll pane: a viewport leaves the list at zero width,
     * which would collapse every horizontal anchor onto the row's left edge and pass vacuously.
     */
    private fun laidOut(): ActiveListView {
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("a", "Alpha"), row("b", "Beta"), row("c", "Gamma")))
        view.list.size = Dimension(320, 200)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        return view
    }

    private fun row(key: String, title: String): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = title
        override val search = title
    }
}
