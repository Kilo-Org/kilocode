package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ACTIVE_CHANGES_CELL
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveCell
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMetrics
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Cursor
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

    /** A dropdown opens below its button, so it anchors on the left edge instead of the middle. */
    fun `test leading row anchor points at the left of the row from its bottom edge`() {
        val view = laidOut()

        val anchor = view.point("b", leading = true)

        val bounds = view.list.getCellBounds(1, 1)!!
        assertTrue("a zero-width row would make the edge assertion vacuous", bounds.width > 0)
        assertSame(view.list, anchor.component)
        assertEquals(bounds.x, anchor.point.x)
        assertEquals(bounds.y + bounds.height, anchor.point.y)
    }

    fun `test anchor for an unknown key falls back to the list origin`() {
        val view = laidOut()

        val anchor = view.point("missing")

        assertSame(view.list, anchor.component)
        assertEquals(0, anchor.point.x)
        assertEquals(0, anchor.point.y)
    }

    fun `test row hit regions retain metadata and exclude hidden reused cells`() {
        var calls = 0
        val action: () -> Unit = { calls++ }
        val item = object : ActiveItem {
            override val key = "regions"
            override val title = "Regions"
            override val leading = listOf(ActiveBadge("Leading", id = "leading", action = action))
            override val badges = listOf(ActiveBadge("Badge", id = "badge", action = action))
            override val secondaryBadges = listOf(ActiveBadge("Secondary", id = "secondary", action = action))
            override val metrics = ActiveMetrics(files = 1, onChanges = action)
            override val cells = listOf(
                ActiveCell(
                    "action", "Action", alwaysVisible = true, tooltip = "Action tooltip",
                    cursor = Cursor.CROSSHAIR_CURSOR, action = action,
                ),
            )
        }
        val busy = object : ActiveItem by item {
            override val key = "busy"
            override val progress = "Working"
        }
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("first", "First"), item, busy))
        view.list.setSize(600, 200)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()

        val hits = activeListHits(view.list, 1, false)

        assertEquals(setOf("leading", "badge", "secondary", "action", ACTIVE_CHANGES_CELL), hits.map { it.id }.toSet())
        val bounds = view.list.getCellBounds(1, 1)
        assertTrue(bounds.y > 0)
        hits.forEach { hit ->
            assertTrue(hit.enabled)
            assertTrue("${hit.id} must occupy visible row space", hit.bounds.width > 0 && hit.bounds.height > 0)
            assertTrue("${hit.id} must use list coordinates", bounds.contains(hit.bounds))
        }
        val hit = hits.single { it.id == "action" }
        assertEquals("Action tooltip", hit.tooltip)
        assertEquals(Cursor.CROSSHAIR_CURSOR, hit.cursor)
        hit.action?.invoke()
        assertEquals(1, calls)
        assertTrue(activeListHits(view.list, 2, false).isEmpty())
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

    private fun row(key: String, title: String): ActiveItem = object : ActiveItem {
        override val key = key
        override val title = title
        override val search = title
    }
}
