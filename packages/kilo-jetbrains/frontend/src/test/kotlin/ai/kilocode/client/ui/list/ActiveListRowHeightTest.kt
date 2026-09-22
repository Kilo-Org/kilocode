package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.CollectionListModel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
import java.awt.event.ComponentEvent
import javax.swing.Icon
import javax.swing.JPanel

/**
 * Row height is remeasured from a snapshot of the rows, and a sectioned list also relayouts whenever
 * that snapshot changes. Owners that poll (the worktree list refreshes stats, PR, and CI state on a
 * timer) hand back value-equal rows on every tick, so the snapshot has to compare equal or every row
 * is measured again several times a minute.
 */
class ActiveListRowHeightTest : BasePlatformTestCase() {
    private val glyph: Icon = EmptyIcon.create(16)
    private val taller: Icon = EmptyIcon.create(40)
    private var reads = 0
    private var clicks = 0

    fun `test resyncing value-equal rows measures nothing again`() {
        val view = settle()
        view.update(rows("a", "b", glyph = glyph))
        reads = 0

        view.update(rows("a", "b", glyph = glyph))

        // Only the height snapshot itself read the rows: a fresh badge action lambda per read must not
        // make the snapshot differ and send both rows back through the renderer.
        assertEquals(2, reads)
    }

    fun `test a changed badge glyph is measured again`() {
        val view = settle()
        view.update(rows("a", "b", glyph = glyph))
        reads = 0

        view.update(rows("a", "b", glyph = taller))

        // The snapshot drops the click handler, not the glyph: a taller badge changes the row height.
        assertTrue("a badge that changed shape must be measured again", reads > 2)
    }

    /** A laid out list, so the first update already snapshots the width the later ones see. */
    private fun settle(): ActiveListView {
        val view = ActiveListView("") { _, _ -> }
        val pane = JPanel()
        pane.add(view)
        pane.setSize(400, 600)
        view.setSize(400, 600)
        view.list.setSize(400, 600)
        view.list.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        return view
    }

    private fun rows(vararg keys: String, glyph: Icon): List<ActiveListItem> = keys.map { Row(it, glyph) }

    /**
     * A row shaped like the worktree list's: equality ignores the click handlers, and the badge getter
     * builds a fresh lambda on every read.
     */
    private inner class Row(override val key: String, private val glyph: Icon) : ActiveListItem {
        override val title get() = key
        override val search get() = key
        override val section get() = "Section"
        override val badges: List<ActiveListBadge>
            get() {
                reads++
                // The handler captures state, so every read allocates a lambda the previous one cannot
                // be equal to — exactly what a badge that opens its own PR url does.
                return listOf(ActiveListBadge("", id = "pr-checks", icon = glyph, action = { clicks++ }))
            }

        override fun equals(other: Any?): Boolean {
            val row = other as? Row ?: return false
            return key == row.key && glyph == row.glyph
        }

        override fun hashCode() = 31 * key.hashCode() + glyph.hashCode()
    }

    // --- ActiveListConfig.wrapDescription ---

    fun `test wrapDescription is opt-in - default config keeps a single-line description at any width`() {
        val renderer = ActiveListRenderer(CollectionListModel(), ActiveListConfig.Preferred)
        val list = JBList<ActiveListItem>()
        val row = wrapRow("word ".repeat(40).trim())

        list.setSize(600, 200)
        val wide = renderer.bodyPreferredHeight(list, row, 0, false, false)
        list.setSize(180, 200)
        val narrow = renderer.bodyPreferredHeight(list, row, 0, false, false)

        // FadeText clips and fades a single line instead of wrapping; the row's height must not
        // depend on the list's width when wrapping was never requested.
        assertEquals("un-opted-in rows must stay one line regardless of width", wide, narrow)
    }

    fun `test wrapDescription grows row height as the list narrows, without growing preferred width`() {
        val renderer = ActiveListRenderer(CollectionListModel(), ActiveListConfig(height = ActiveListRowHeight.PREFERRED, wrapDescription = true))
        val list = JBList<ActiveListItem>()
        val row = wrapRow("word ".repeat(40).trim())

        list.setSize(600, 200)
        val wideHeight = renderer.bodyPreferredHeight(list, row, 0, false, false)
        val wideWidth = renderer.getListCellRendererComponent(list, row, 0, false, false).preferredSize.width

        list.setSize(180, 200)
        val narrowHeight = renderer.bodyPreferredHeight(list, row, 0, false, false)
        val narrowWidth = renderer.getListCellRendererComponent(list, row, 0, false, false).preferredSize.width

        assertTrue("a narrower list must wrap the body onto more lines", narrowHeight > wideHeight)
        // The row body tracks the list's own width (HAlign.TRACK contributes zero to preferred
        // width); a taller wrap must never widen what the row reports back to the list.
        assertTrue("wrapping a taller body must not grow the row's preferred width", narrowWidth <= wideWidth)
    }

    fun `test wrapDescription preserves explicit line breaks in the underlying text component`() {
        val renderer = ActiveListRenderer(CollectionListModel(), ActiveListConfig(height = ActiveListRowHeight.PREFERRED, wrapDescription = true))
        val list = JBList<ActiveListItem>()
        list.setSize(400, 200)
        val row = wrapRow("first line\nsecond line")

        val comp = renderer.getListCellRendererComponent(list, row, 0, false, false)

        val area = UIUtil.findComponentOfType(comp, JBTextArea::class.java) ?: error("expected a wrapping text area")
        assertEquals("first line\nsecond line", area.text)
    }

    fun `test wrapDescription body color matches the row regardless of selection`() {
        val renderer = ActiveListRenderer(CollectionListModel(), ActiveListConfig(height = ActiveListRowHeight.PREFERRED, wrapDescription = true))
        val list = JBList<ActiveListItem>()
        list.setSize(400, 200)
        val row = wrapRow("body text")

        val unselected = UIUtil.findComponentOfType(
            renderer.getListCellRendererComponent(list, row, 0, false, false),
            JBTextArea::class.java,
        ) ?: error("expected a wrapping text area")
        val selected = UIUtil.findComponentOfType(
            renderer.getListCellRendererComponent(list, row, 0, true, true),
            JBTextArea::class.java,
        ) ?: error("expected a wrapping text area")

        assertEquals(UiStyle.Colors.weak(), unselected.foreground)
        assertEquals(UiStyle.Colors.weak(), selected.foreground)
    }

    fun `test wrapDescription remeasures cached preferred heights when the list narrows`() {
        edtWait {
            val view = ActiveListView("", ActiveListConfig(height = ActiveListRowHeight.PREFERRED, wrapDescription = true)) { _, _ -> }
            val pane = JPanel()
            pane.add(view)
            pane.setSize(600, 400)
            view.setSize(600, 400)
            view.list.setSize(600, 400)
            view.update(listOf(wrapRow("word ".repeat(60).trim())))
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val wide = view.list.getCellBounds(0, 0).height

            view.list.setSize(180, 400)
            view.list.componentListeners.forEach { it.componentResized(ComponentEvent(view.list, ComponentEvent.COMPONENT_RESIZED)) }
            view.list.doLayout()
            UIUtil.dispatchAllInvocationEvents()
            val narrow = view.list.getCellBounds(0, 0).height

            assertTrue("a narrower list must invalidate the old preferred row height: wide=$wide narrow=$narrow", narrow > wide)
        }
    }

    private fun wrapRow(description: String): ActiveListItem = object : ActiveListItem {
        override val key = "row"
        override val title = "Title"
        override val description = description
    }
}
