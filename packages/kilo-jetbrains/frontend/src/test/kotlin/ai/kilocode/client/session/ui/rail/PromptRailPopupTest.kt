package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRowHeight
import com.intellij.openapi.options.advanced.AdvancedSettings
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Rectangle
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent
import javax.swing.JList
import javax.swing.JScrollPane
import javax.swing.KeyStroke
import javax.swing.JViewport

class PromptRailPopupTest : BasePlatformTestCase() {
    /**
     * Lays the body out the way the platform does: clamp it with [PromptRailPopup.fitWithin], size it to
     * the preferred size that clamp produces, then lay out. The earlier version of this test sized the
     * body to an arbitrary height instead, which hid the bug where the list never clipped.
     */
    private fun shown(count: Int, hovered: Int = 0): Fixture {
        val popup = popup(items(count), hovered)
        popup.fitWithin(CAP_W, CAP_H)
        val root = popup.component
        root.size = root.preferredSize
        layoutAll(root)
        val scroll = findScroll(root) ?: error("expected the row list to own a scroll pane")
        return Fixture(popup, scroll.viewport)
    }

    private class Fixture(val popup: PromptRailPopup, val port: JViewport)

    /** Exactly one scroll pane: a nested second one left neither owning the scrolling. */
    fun `test the row list owns the only scroll pane`() {
        val fix = shown(40)

        assertEquals(1, countScrolls(fix.popup.component))

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * The regression: the viewport has to actually clip. It previously inherited a ~32k extent from the
     * wrapper's `Short.MAX_VALUE` measuring pass, so every row counted as visible and nothing scrolled.
     */
    fun `test the viewport clips to the balloon instead of the content`() {
        val fix = shown(40)
        val view = fix.port.view ?: error("expected a view")

        assertTrue("extent ${fix.port.extentSize.height} must be clamped", fix.port.extentSize.height <= CAP_H)
        assertTrue(
            "content ${view.height} must exceed the extent ${fix.port.extentSize.height} so it can scroll",
            view.height > fix.port.extentSize.height,
        )

        Disposer.dispose(fix.popup.disposable)
    }

    /** Revealing downwards was the broken direction, so both are covered explicitly. */
    fun `test rows reveal in both directions`() {
        val fix = shown(40)

        fix.popup.select(39)
        val down = fix.port.viewPosition.y
        assertTrue("selecting the last row must scroll down, stayed at $down", down > 0)

        fix.popup.select(0)
        assertEquals("selecting the first row must scroll back to the top", 0, fix.port.viewPosition.y)

        fix.popup.select(39)
        assertEquals("the last row must scroll down again", down, fix.port.viewPosition.y)

        Disposer.dispose(fix.popup.disposable)
    }

    /** A row requested before the body had bounds still has to be revealed once it does. */
    fun `test a row requested before layout is revealed once laid out`() {
        val popup = popup(items(40), hovered = 30)
        popup.fitWithin(CAP_W, CAP_H)
        val root = popup.component

        // Pre-layout there is no viewport to measure, so nothing may be scrolled yet.
        assertNull(findScroll(root)?.viewport?.view?.takeIf { it.height > 0 })

        root.size = root.preferredSize
        layoutAll(root)

        val port = findScroll(root)?.viewport ?: error("expected the row list to own a scroll pane")
        assertTrue("row 30 must be revealed once laid out", port.viewPosition.y > 0)

        // Replaying layout must not drift the settled position.
        val settled = port.viewPosition
        layoutAll(root)
        assertEquals(settled, port.viewPosition)

        Disposer.dispose(popup.disposable)
    }

    /** Every hovered row must end up visible, whichever way the pointer travels. */
    fun `test every hovered row is revealed`() {
        val fix = shown(40)

        val list = findList(fix.popup.component) ?: error("expected a JList of rows")
        for (index in listOf(39, 0, 20, 7, 33, 12, 38, 1)) {
            fix.popup.select(index)

            assertEquals("row $index must be selected", index, list.selectedIndex)
            val view = Rectangle(fix.port.viewPosition, fix.port.extentSize)
            val cell = list.getCellBounds(index, index)
            assertTrue("row $index at $cell must be visible in $view", view.contains(cell))
        }

        Disposer.dispose(fix.popup.disposable)
    }

    fun `test the body honors the width and height caps`() {
        val fix = shown(40)
        val pref = fix.popup.component.preferredSize

        assertTrue("width ${pref.width} must not exceed $CAP_W", pref.width <= CAP_W)
        assertTrue("height ${pref.height} must not exceed $CAP_H", pref.height <= CAP_H)

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * A clicked row was reachable under the pointer, so the list must not move: re-centring it would
     * shift content out from under a deliberate click. Only tick hovers and the buttons scroll it.
     */
    fun `test selecting without scroll highlights but never moves the list`() {
        val fix = shown(40)
        val list = findList(fix.popup.component) ?: error("expected a JList of rows")

        // Park the list somewhere mid-range so a re-centre would be visible either way.
        fix.popup.select(20)
        val parked = fix.port.viewPosition

        // A row far outside the view: still no movement, because the click came from the user.
        fix.popup.select(39, scroll = false)
        assertEquals(39, list.selectedIndex)
        assertEquals("a clicked row must not move the list", parked, fix.port.viewPosition)

        fix.popup.select(0, scroll = false)
        assertEquals(0, list.selectedIndex)
        assertEquals(parked, fix.port.viewPosition)

        // A later layout must not replay a reveal the click suppressed.
        layoutAll(fix.popup.component)
        assertEquals(parked, fix.port.viewPosition)

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * The navigator opens on hover, so a tooltip would stack a second floating surface over it.
     *
     * Rows are asked through `getToolTipText(event)` with the pointer over a cell, which is where
     * `ActiveListView` consults `cfg.tooltip`. The `JComponent.toolTipText` property is never set on
     * this list, so asserting on it would pass either way and prove nothing.
     */
    fun `test the popup shows no row or button tooltips`() {
        val fix = shown(40)
        val list = findList(fix.popup.component) ?: error("expected a JList of rows")
        val cell = list.getCellBounds(0, 0)
        val over = MouseEvent(
            list,
            MouseEvent.MOUSE_MOVED,
            0L,
            0,
            cell.x + cell.width / 2,
            cell.y + cell.height / 2,
            0,
            false,
        )

        assertNull("rows must not serve a tooltip", list.getToolTipText(over))

        for (button in findButtons(fix.popup.component)) {
            assertNull("header buttons must not carry a tooltip", button.toolTipText)
            // Still labelled for screen readers.
            assertNotNull(button.accessibleContext.accessibleName)
        }

        Disposer.dispose(fix.popup.disposable)
    }

    /**
     * Guards the assertion above: the same list with tooltips left on does serve one, so the suppression
     * is what the other test observes rather than some unrelated reason for a null.
     */
    fun `test a row tooltip is served when the config leaves it on`() {
        val rows = ActiveList(
            emptyText = "",
            cfg = ActiveListConfig(height = ActiveListRowHeight.PREFERRED, wrapDescription = true),
            showSearch = false,
            onCell = { _, _ -> },
        )
        rows.update(items(40).map { Row(it.id, it.prompt, it.answer) })
        rows.size = Dimension(CAP_W, CAP_H)
        layoutAll(rows)
        val list = findList(rows) ?: error("expected a JList of rows")
        val cell = list.getCellBounds(0, 0)
        val over = MouseEvent(
            list,
            MouseEvent.MOUSE_MOVED,
            0L,
            0,
            cell.x + cell.width / 2,
            cell.y + cell.height / 2,
            0,
            false,
        )

        assertNotNull("the default config must serve a row tooltip", list.getToolTipText(over))
    }

    /**
     * A single click browses, so it navigates with the card left open. A double click is a committed
     * pick, so it navigates and reports the flag the controller closes on.
     */
    fun `test clicks report the commit flag for single and double`() {
        val seen = mutableListOf<Pair<String, Boolean>>()
        val popup = PromptRailPopup(
            items = items(40),
            hovered = 0,
            onSelect = { item, commit -> seen.add(item.id to commit) },
            onFirst = {},
            onLatest = {},
        )
        popup.fitWithin(CAP_W, CAP_H)
        val root = popup.component
        root.size = root.preferredSize
        layoutAll(root)
        val list = findList(root) ?: error("expected a JList of rows")

        click(list, index = 1, count = 1)
        click(list, index = 1, count = 2)

        // Swing delivers count 1 then count 2 for a double click, so the committed pick is the last.
        assertEquals("msg_1" to false, seen.first())
        assertEquals("msg_1" to true, seen.last())

        Disposer.dispose(popup.disposable)
    }

    /**
     * Enter has to commit like a double click. The list's default provider reports the global
     * `edit.source.on.enter.key.request.focus.in.editor` setting, so without an override Enter would
     * close the card on installs where that is on and leave it open everywhere else.
     */
    fun `test enter commits regardless of the editor focus setting`() {
        // The setting defaults to on, which is indistinguishable from the override. Turn it off, which
        // is the install state where the default provider would report false and leave the card open.
        val restore = AdvancedSettings.getBoolean(ENTER_FOCUS)
        AdvancedSettings.setBoolean(ENTER_FOCUS, false)
        try {
            val seen = mutableListOf<Pair<String, Boolean>>()
            val popup = PromptRailPopup(
                items = items(40),
                hovered = 3,
                onSelect = { item, commit -> seen.add(item.id to commit) },
                onFirst = {},
                onLatest = {},
            )
            popup.fitWithin(CAP_W, CAP_H)
            val root = popup.component
            root.size = root.preferredSize
            layoutAll(root)
            val list = findList(root) ?: error("expected a JList of rows")

            val enter = list.getActionForKeyStroke(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0))
                ?: error("expected an Enter binding on the row list")
            enter.actionPerformed(ActionEvent(list, ActionEvent.ACTION_PERFORMED, null))

            assertEquals(listOf("msg_3" to true), seen)

            Disposer.dispose(popup.disposable)
        } finally {
            AdvancedSettings.setBoolean(ENTER_FOCUS, restore)
        }
    }

    /**
     * Only the click is dispatched. A press would reach `BasicListUI`, whose selection handling asks the
     * toolkit for the menu shortcut mask and throws headlessly, and `onOpen` is driven from the click.
     */
    private fun click(list: JList<*>, index: Int, count: Int) {
        val cell = list.getCellBounds(index, index)
        list.dispatchEvent(
            MouseEvent(
                list,
                MouseEvent.MOUSE_CLICKED,
                0L,
                0,
                cell.x + cell.width / 2,
                cell.y + cell.height / 2,
                count,
                false,
                MouseEvent.BUTTON1,
            ),
        )
    }

    private data class Row(
        override val key: String,
        override val title: String,
        override val description: String?,
    ) : ActiveListItem

    /**
     * The header buttons have to drive the same navigation the ticks do. Scrolling the transcript alone
     * would leave the open card pointing at whichever row was last hovered.
     */
    fun `test the header buttons invoke first and latest navigation`() {
        val seen = mutableListOf<String>()
        val popup = PromptRailPopup(
            items = items(40),
            hovered = 0,
            onSelect = { _, _ -> },
            onFirst = { seen.add("first") },
            onLatest = { seen.add("latest") },
        )
        popup.fitWithin(CAP_W, CAP_H)
        val buttons = findButtons(popup.component)
        assertEquals("expected the first/latest buttons in the header", 2, buttons.size)

        buttons[0].doClick()
        buttons[1].doClick()

        assertEquals(listOf("first", "latest"), seen)

        Disposer.dispose(popup.disposable)
    }

    private fun findButtons(c: Component): List<HoverIcon> {
        if (c is HoverIcon) return listOf(c)
        if (c !is Container) return emptyList()
        return c.components.flatMap { findButtons(it) }
    }

    private fun findList(c: Component): JList<*>? {
        if (c is JList<*>) return c
        if (c !is Container) return null
        return c.components.firstNotNullOfOrNull { findList(it) }
    }

    private fun countScrolls(c: Component): Int {
        val self = if (c is JScrollPane) 1 else 0
        if (c !is Container) return self
        return self + c.components.sumOf { countScrolls(it) }
    }

    private fun findScroll(c: Component): JScrollPane? {
        if (c is JScrollPane) return c
        if (c !is Container) return null
        return c.components.firstNotNullOfOrNull { findScroll(it) }
    }

    private fun layoutAll(c: Component) {
        c.doLayout()
        if (c is Container) c.components.forEach(::layoutAll)
    }

    private fun popup(items: List<PromptRailItem>, hovered: Int = 0) = PromptRailPopup(
        items = items,
        hovered = hovered,
        onSelect = { _, _ -> },
        onFirst = {},
        onLatest = {},
    )

    private fun items(count: Int) = List(count) {
        PromptRailItem(
            id = "msg_$it",
            queued = false,
            prompt = "Prompt $it that is long enough to be clamped by the navigator row width",
            answer = "Answer $it that is also long enough to wrap across the lines the row allows",
        )
    }

    private companion object {
        const val ENTER_FOCUS = "edit.source.on.enter.key.request.focus.in.editor"
        const val CAP_W = 320
        const val CAP_H = 260
    }
}
