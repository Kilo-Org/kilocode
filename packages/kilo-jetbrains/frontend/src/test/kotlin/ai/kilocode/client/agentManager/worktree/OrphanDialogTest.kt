package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.OrphanDto
import ai.kilocode.rpc.dto.OrphanKind
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.ui.table.JBTable
import java.awt.Component
import java.awt.Container
import javax.swing.Icon
import javax.swing.JEditorPane
import javax.swing.table.TableColumn

/**
 * [OrphanDialog] default selection and delete-button label, driven through the real Swing table
 * model rather than any test-only seam — [OrphanTableModel.setValueAt] is exactly what a checkbox
 * cell editor calls when a user clicks it.
 */
private const val COLUMN_REVEAL_INDEX = 4

class OrphanDialogTest : BasePlatformTestCase() {
    private var dialog: OrphanDialog? = null

    override fun tearDown() {
        try {
            dialog?.let { d -> edt { if (!d.isDisposed) d.close(0) } }
            dialog = null
        } finally {
            super.tearDown()
        }
    }

    fun `test leftover rows are pre-selected and broken rows are not`() {
        open(
            OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER),
            OrphanDto("/repo/.kilo/worktrees/broken", OrphanKind.BROKEN),
        )

        val table = table()
        assertEquals(true, edt { table.model.getValueAt(0, 0) })
        assertEquals(false, edt { table.model.getValueAt(1, 0) })
    }

    fun `test delete button label reflects the current selection`() {
        open(
            OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER),
            OrphanDto("/repo/.kilo/worktrees/broken", OrphanKind.BROKEN),
        )
        val table = table()

        val initial = edt { requireNotNull(dialog).okButtonText() }
        assertTrue("expected the initial label to mention 1 folder -> $initial", initial!!.contains("1"))

        edt { table.model.setValueAt(true, 1, 0) }

        val updated = edt { requireNotNull(dialog).okButtonText() }
        assertTrue("expected the label to update to 2 folders -> $updated", updated!!.contains("2"))
    }

    fun `test the ok action is disabled once every row is deselected`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val table = table()
        assertTrue(edt { requireNotNull(dialog).isOKActionEnabled })

        edt { table.model.setValueAt(false, 0, 0) }

        assertFalse(edt { requireNotNull(dialog).isOKActionEnabled })
    }

    fun `test result is null until confirmed`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))

        assertNull(edt { requireNotNull(dialog).result() })
    }

    fun `test result carries the selected paths once confirmed`() {
        open(
            OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER),
            OrphanDto("/repo/.kilo/worktrees/broken", OrphanKind.BROKEN),
        )

        edt { requireNotNull(dialog).doOKAction() }

        assertEquals(listOf("/repo/.kilo/worktrees/leftover"), edt { requireNotNull(dialog).result() })
    }

    /**
     * A `HEADER_ROW` model event makes JTable rebuild its columns from the model, dropping every fixed
     * width — which is what a checkbox toggle used to do, leaving the check and reveal columns as wide
     * as the resizable ones.
     */
    fun `test the fixed columns keep their width and stay unresizable after a toggle`() {
        open(
            OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER),
            OrphanDto("/repo/.kilo/worktrees/broken", OrphanKind.BROKEN),
        )
        val table = table()
        val widths = edt { listOf(column(table, 0).width, column(table, COLUMN_REVEAL_INDEX).width) }

        edt { table.model.setValueAt(true, 1, 0) }

        assertEquals(widths, edt { listOf(column(table, 0).width, column(table, COLUMN_REVEAL_INDEX).width) })
        assertFalse("the check column must not be resizable", edt { column(table, 0).resizable })
        assertFalse("the reveal column must not be resizable", edt { column(table, COLUMN_REVEAL_INDEX).resizable })
        assertTrue("the path column stays resizable", edt { column(table, 1).resizable })
    }

    fun `test the reveal column renders an icon and is not editable`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val table = table()

        assertTrue(edt { table.model.getValueAt(0, COLUMN_REVEAL_INDEX) } is Icon)
        assertFalse(edt { table.model.isCellEditable(0, COLUMN_REVEAL_INDEX) })
        assertTrue("only the check column is editable", edt { table.model.isCellEditable(0, 0) })
    }

    fun `test the header explains where the folders come from`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))

        val north = edt { requireNotNull(dialog).northComponent() }
        val text = components(north).filterIsInstance<JEditorPane>().joinToString(" ") { edt { it.text ?: "" } }

        assertTrue("the explanation must be a standard banner -> ${north.javaClass.name}", north is InlineBanner)
        assertEquals(
            "the banner must carry the platform info colors",
            EditorNotificationPanel.Status.Info,
            edt { (north as InlineBanner).status },
        )
        assertTrue("expected the worktree directory to be named -> $text", text.contains(".kilo/worktrees"))
        assertTrue("expected git detection to be explained -> $text", text.contains("git"))
        assertFalse("every help string must resolve -> $text", text.contains("!worktree.orphans"))
    }

    /**
     * The bullet detail (uncommitted-work warning, likely causes, delete semantics) is collapsed
     * behind a Show more / Show less link; only the intro sentence is visible up front.
     */
    fun `test the header explanation is collapsed to its intro until Show more is clicked`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val north = edt { requireNotNull(dialog).northComponent() }

        val collapsedText = edt { messageText(north) }
        assertTrue("expected the intro up front -> $collapsedText", collapsedText.contains(".kilo/worktrees"))
        assertFalse("bullets must stay hidden until expanded -> $collapsedText", collapsedText.contains("uncommitted"))

        val toggle = edt { linkLabel(north) }
        assertEquals("Show more", edt { toggle.text })

        edt { toggle.doClick() }

        val expandedText = edt { messageText(north) }
        assertTrue("expected the checkout case once expanded -> $expandedText", expandedText.contains("uncommitted"))
        assertEquals("Show less", edt { toggle.text })

        edt { toggle.doClick() }

        val recollapsedText = edt { messageText(north) }
        assertFalse("bullets must hide again on a second click -> $recollapsedText", recollapsedText.contains("uncommitted"))
        assertEquals("Show more", edt { toggle.text })
    }

    /**
     * The overlay scrollbar paints over the viewport, so the right-hand column needs a reserved strip.
     * `ScrollPaneLayout` widens the column header by the viewport insets but shifts it left by the left
     * inset only, so the strip has to be right-only or the header stops lining up with the rows.
     */
    fun `test the viewport reserves a right-only strip for the scrollbar`() {
        open(OrphanDto("/repo/.kilo/worktrees/leftover", OrphanKind.LEFTOVER))
        val scroll = components(edt { requireNotNull(dialog).centerComponent() }).filterIsInstance<JBScrollPane>().single()

        val insets = edt { requireNotNull(scroll.viewportBorder).getBorderInsets(scroll) }

        assertTrue("expected a reserved strip on the right -> $insets", insets.right > 0)
        assertEquals("a left inset would shift the rows out from under the header", 0, insets.left)
        assertEquals(0, insets.top)
        assertEquals(0, insets.bottom)
    }

    fun `test footer mentions checkouts only when a broken row is selected`() {
        open(OrphanDto("/repo/.kilo/worktrees/broken", OrphanKind.BROKEN))
        val table = table()
        val footer = footer()

        assertFalse(edt { footer.text }.contains("checkout"))

        edt { table.model.setValueAt(true, 0, 0) }

        assertTrue(edt { footer.text }.contains("checkout"))
    }

    private fun open(vararg orphans: OrphanDto, sizes: Map<String, Long> = emptyMap()) {
        dialog = edt { OrphanDialog(JBPanel<Nothing>(), project, orphans.toList(), sizes) }
    }

    private fun table(): JBTable = components(edt { requireNotNull(dialog).centerComponent() }).filterIsInstance<JBTable>().single()

    private fun footer(): JBLabel = components(edt { requireNotNull(dialog).centerComponent() }).filterIsInstance<JBLabel>().first()

    private fun column(table: JBTable, index: Int): TableColumn = table.columnModel.getColumn(index)

    private fun messageText(north: Component): String =
        components(north).filterIsInstance<JEditorPane>().joinToString(" ") { it.text ?: "" }

    /**
     * [InlineBanner] always carries a second, initially-invisible `LinkLabel` — its overflow
     * "More" dropdown, shown only once there are 4+ actions — so the one visible link is ours.
     */
    @Suppress("UNCHECKED_CAST")
    private fun linkLabel(north: Component): LinkLabel<Runnable> =
        components(north).filterIsInstance<LinkLabel<*>>().single { it.isVisible } as LinkLabel<Runnable>

    private fun components(root: Component): List<Component> = buildList {
        add(root)
        if (root is Container) root.components.forEach { addAll(components(it)) }
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
