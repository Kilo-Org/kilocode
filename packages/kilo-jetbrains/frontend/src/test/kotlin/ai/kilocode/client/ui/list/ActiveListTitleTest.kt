package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.image.BufferedImage
import javax.swing.JPanel

/**
 * A row title that does not fit has to end in an ellipsis, the way the description line under it always
 * has. [SimpleColoredComponent] hard-clips by default while a `JBLabel` ellipses, so the two lines of the
 * same row disagreed: the description said "there is more text here" and the title just stopped, reading
 * as the name of the thing rather than a truncation of it.
 *
 * Clipping happens at paint time, so these paint the renderer's own title component. A hard clip is exactly
 * the wide render cut at the edge — same glyphs, same positions, just fewer of them — so comparing a narrow
 * render against a crop of the wide one separates the two behaviors without depending on font metrics.
 */
class ActiveListTitleTest : BasePlatformTestCase() {
    fun `test a title too long for the row ends in an ellipsis rather than a cut`() {
        val title = titleOf(Row(LONG))

        val narrow = paint(title, NARROW)
        val cut = crop(paint(title, WIDE), NARROW)

        assertFalse("a squeezed title must not be the roomy one cut at the edge", same(narrow, cut))
        // Identical until well into the string: the same title in the same place, ending differently — not
        // a different layout that merely happens to differ.
        assertTrue("the whole title was repainted, not just its tail: ${diff(narrow, cut)}", diff(narrow, cut) > NARROW / 3)
        // Periods sit on the baseline while LONG's capitals reach the cap height, so a tail of dots carries
        // its ink lower down than a tail of letters does. This is what distinguishes "..." from any other
        // way the tail could have changed.
        assertTrue(
            "the title tail is still letters, not an ellipsis: ${tail(narrow)} vs ${tail(cut)}",
            tail(narrow) > tail(cut),
        )
    }

    fun `test a title with room to spare is painted whole`() {
        val title = titleOf(Row("short"))

        // Nothing to clip, so the clipper is invisible: the painted text does not move or shorten when the
        // component is given more room than it needs.
        assertTrue(same(paint(title, WIDE), crop(paint(title, WIDE * 2), WIDE)))
    }

    fun `test the note beside a title ellipses too`() {
        val title = titleOf(Row("name", note = LONG))

        val narrow = paint(title, NARROW)
        val cut = crop(paint(title, WIDE), NARROW)

        // The note is the fragment that runs out of room here, so it is the one that has to ellipse.
        assertFalse(same(narrow, cut))
        assertTrue("the note tail is still letters: ${tail(narrow)} vs ${tail(cut)}", tail(narrow) > tail(cut))
    }

    /** The renderer's title component, configured for [row] exactly as a real list would configure it. */
    private fun titleOf(row: ActiveListItem): SimpleColoredComponent {
        val view = settle()
        view.update(listOf(row))
        val list = view.list
        val renderer = list.cellRenderer.getListCellRendererComponent(list, list.model.getElementAt(0), 0, false, false)
        return components(renderer).filterIsInstance<SimpleColoredComponent>().single()
    }

    /**
     * Painted at [width], always at the same height so crops of two renders line up. Deliberately an
     * unscaled image rather than `UIUtil.createImage`, whose HiDPI backing would make a pixel column and a
     * layout column different things and break the crop arithmetic.
     */
    private fun paint(component: SimpleColoredComponent, width: Int): BufferedImage {
        component.size = Dimension(width, HEIGHT)
        component.doLayout()
        val image = BufferedImage(width, HEIGHT, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            component.paint(canvas)
        } finally {
            canvas.dispose()
        }
        return image
    }

    private fun crop(image: BufferedImage, width: Int): BufferedImage = image.getSubimage(0, 0, width, image.height)

    /** The rightmost column carrying any ink, which is where the painted text ends. */
    private fun ink(image: BufferedImage): Int {
        for (x in image.width - 1 downTo 0) {
            for (y in 0 until image.height) {
                if (image.getRGB(x, y) and ALPHA != 0) return x
            }
        }
        return -1
    }

    /** The first column where two renders disagree, or -1 when they never do. */
    private fun diff(a: BufferedImage, b: BufferedImage): Int {
        for (x in 0 until minOf(a.width, b.width)) {
            for (y in 0 until minOf(a.height, b.height)) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) return x
            }
        }
        return -1
    }

    /** How far down the highest ink sits across the last [TAIL] inked columns. */
    private fun tail(image: BufferedImage): Int {
        val end = ink(image)
        for (y in 0 until image.height) {
            for (x in (end - TAIL).coerceAtLeast(0)..end) {
                if (image.getRGB(x, y) and ALPHA != 0) return y
            }
        }
        return image.height
    }

    private fun same(a: BufferedImage, b: BufferedImage): Boolean {
        if (a.width != b.width || a.height != b.height) return false
        for (x in 0 until a.width) {
            for (y in 0 until a.height) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) return false
            }
        }
        return true
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf(root)
        if (root is Container) root.components.forEach { out += components(it) }
        return out
    }

    /** A laid out list, so the renderer measures against a real width. */
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

    private class Row(override val title: String, override val note: String? = null) : ActiveListItem {
        override val key get() = "row"
        override val search get() = title
    }

    private companion object {
        // No spaces, so a hard clip is guaranteed to cut mid-glyph and reach the final column.
        val LONG = "M".repeat(120)
        const val NARROW = 120
        const val WIDE = 4000
        const val HEIGHT = 24
        const val ALPHA = 0xFF shl 24

        /** Columns of the painted tail to measure, wide enough to cover "..." and no wider. */
        const val TAIL = 8
    }
}
