package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
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
}
