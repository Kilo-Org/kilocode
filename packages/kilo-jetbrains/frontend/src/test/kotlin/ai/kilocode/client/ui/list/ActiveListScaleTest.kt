package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.ExpandedItemListCellRendererWrapper
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.IJSwingUtilities
import com.intellij.util.ui.UIUtil
import javax.swing.UIManager
import javax.swing.plaf.FontUIResource

/**
 * Regression coverage for the Agent Manager / session-history list not re-scaling when the global
 * IntelliJ interface zoom changes (`View | Appearance | Zoom IDE In/Out`).
 *
 * [zoom] plus [refresh] reproduce what the platform actually does, so these tests fail if the production
 * refresh path breaks: `LafManagerImpl.patchLafFonts` raises the `*.font` UI defaults and the JBUI user
 * scale factor, then `IJSwingUtilities.updateComponentTreeUI` walks the window. That walk reaches the
 * list but *not* the shared renderer stamp — `JList.updateUI` only forwards to a renderer that is itself
 * a `Component`, and `JBList` wraps ours in a non-`Component` adapter — so the list has to refresh the
 * stamp itself. Nothing here refreshes the stamp directly, on purpose.
 *
 * Both halves of a zoom matter. Fonts follow the `*.font` defaults on their own, because a `JBFont`
 * re-derives its size from "Label.font" whenever it is read. Everything resolved through `JBUI.scale`
 * (theme insets, layout gaps, measured row heights) is a plain pixel count that changes only when it is
 * recomputed, which is what these tests pin down.
 */
@Suppress("UnstableApiUsage")
class ActiveListScaleTest : BasePlatformTestCase() {

    fun `test row height is re measured after a zoom instead of staying at the pre zoom size`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(rows("a", "b"))
        val before = view.list.fixedCellHeight
        assertTrue("expected a real fixed row height, got $before", before > 0)

        zoom(2f) {
            refresh(view)

            val after = view.list.fixedCellHeight
            assertTrue("expected the row height to grow with the zoom, was $before then $after", after > before)
        }
    }

    fun `test row height shrinks back after zooming out again`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(rows("a"))
        val base = view.list.fixedCellHeight

        zoom(2f) {
            refresh(view)
            assertTrue("expected the row height to grow first", view.list.fixedCellHeight > base)
        }
        refresh(view)

        assertEquals(base, view.list.fixedCellHeight)
    }

    /**
     * Sectioned rows are what the Agent Manager renders, and they take the other branch of the height
     * sync: `fixedCellHeight` stays at -1 and the measured body height is pushed onto the renderer
     * instead. Zooming out has to bring that body height back down.
     */
    fun `test sectioned row body height shrinks back after zooming out again`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("a", section = "Local"), row("b", section = "Local")))
        val base = body(view)
        assertTrue("expected a real body height, got $base", base > 0)

        zoom(2f) {
            refresh(view)
            assertTrue("expected the body height to grow first, was $base then ${body(view)}", body(view) > base)
        }
        refresh(view)

        assertEquals(base, body(view))
    }

    /**
     * The Agent Manager's own row shape: a section, diff metrics and a PR badge. The metrics strip
     * carries its own nested layout gaps and a minimum height, so it dominates the measured row height
     * and is where a stuck pre-zoom size actually shows up.
     */
    fun `test sectioned row with metrics and badge shrinks back after zooming out again`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(
            listOf(
                row("a", section = "Local", metrics = ActiveListMetrics(files = 14, additions = 742, deletions = 169), badge = "#12967"),
                row("b", section = "Local"),
            ),
        )
        val base = body(view)
        assertTrue("expected a real body height, got $base", base > 0)

        zoom(2f) {
            refresh(view)
            assertTrue("expected the body height to grow first, was $base then ${body(view)}", body(view) > base)
        }
        refresh(view)

        assertEquals(base, body(view))
    }

    /**
     * Proves the list refreshes the renderer stamp, using a value that only [JBUI.scale] feeds: a
     * layout gap. A layout manager captures its gap as a plain pixel count when it is created, so unlike
     * the fonts around it, the stamp's internal spacing stays at its pre-zoom size unless the stamp is
     * re-initialized — which is what left the section header and the row metrics misaligned against
     * text that had grown.
     */
    fun `test renderer layout gaps are re derived after a zoom`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("a", section = "Local")))
        val before = gaps(view)
        assertTrue("expected real layout gaps, got $before", before > 0)

        zoom(2f) {
            refresh(view)

            val after = gaps(view)
            assertTrue("expected the layout gaps to grow with the zoom, was $before then $after", after > before)
        }
    }

    fun `test section header band grows after a zoom`() {
        val view = ActiveListView("") { _, _ -> }
        view.update(listOf(row("a", section = "Local")))
        val before = band(view)
        assertTrue("expected a real section band height, got $before", before > 0)

        zoom(2f) {
            refresh(view)

            val after = band(view)
            assertTrue("expected the section band to grow with the zoom, was $before then $after", after > before)
        }
    }

    /**
     * Applies a real IDE zoom for the duration of [block]: the font defaults and the user scale.
     *
     * The installed font must be a [FontUIResource], exactly as `LafManagerImpl.patchLafFonts` installs
     * it. [javax.swing.LookAndFeel.installColorsAndFont] only replaces a component's font when the
     * current one is `null` or a `UIResource`, so handing the defaults a plain font would let components
     * adopt it once and then refuse every later update — the zoom would appear to stick permanently, in
     * the test rather than in the product.
     */
    private fun zoom(factor: Float, block: () -> Unit) {
        val label = UIManager.getFont("Label.font")
        val scale = JBUIScale.scale(1f)
        val keys = UIManager.getDefaults().keys.toList().filterIsInstance<String>().filter { it.endsWith(".font") }
        val fonts = keys.associateWith { UIManager.getFont(it) }
        try {
            val bigger = FontUIResource(label.deriveFont(label.size2D * factor))
            keys.forEach { UIManager.put(it, bigger) }
            JBUIScale.setUserScaleFactorForTest(scale * factor)
            block()
        } finally {
            JBUIScale.setUserScaleFactorForTest(scale)
            fonts.forEach { (key, font) -> UIManager.put(key, FontUIResource(font)) }
        }
    }

    /** The platform's own Look-and-Feel pass over the list, which never reaches the renderer stamp. */
    private fun refresh(view: ActiveListView) = IJSwingUtilities.updateComponentTreeUI(view)

    /** Height the stamp gives a row body, which is what sectioned lists size their rows with. */
    private fun body(view: ActiveListView): Int {
        return stamp(view).bodyPreferredHeight(view.list, view.list.model.getElementAt(0), 0, true, true)
    }

    /** Widest spacing any row in the stamp lays its children out with. */
    private fun gaps(view: ActiveListView): Int {
        return UIUtil.uiTraverser(stamp(view)).filterIsInstance(Stack::class.java).maxOf { it.space }
    }

    /** Height the stamp gives the section band while rendering the first row. */
    private fun band(view: ActiveListView): Int {
        val stamp = stamp(view)
        stamp.getListCellRendererComponent(view.list, view.list.model.getElementAt(0), 0, false, false)
        return UIUtil.findComponentOfType(stamp, GroupHeaderSeparator::class.java)!!.preferredSize.height
    }

    /** [JBList.setCellRenderer] wraps whatever renderer is assigned, so unwrap it back. */
    private fun stamp(view: ActiveListView): ActiveListRenderer {
        return ExpandedItemListCellRendererWrapper.unwrap(view.list.cellRenderer) as ActiveListRenderer
    }

    private fun rows(vararg keys: String): List<ActiveListItem> = keys.map { row(it) }

    private fun row(
        key: String,
        section: String? = null,
        metrics: ActiveListMetrics? = null,
        badge: String? = null,
    ): ActiveListItem = object : ActiveListItem {
        override val key = key
        override val title = key
        override val description = "desc"
        override val section = section
        override val metrics = metrics
        override val secondaryBadges = badge?.let { listOf(ActiveListBadge(it, UiStyle.Badge.Secondary)) }.orEmpty()
    }
}
