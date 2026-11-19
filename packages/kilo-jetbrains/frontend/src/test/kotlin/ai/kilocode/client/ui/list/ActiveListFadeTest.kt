package ai.kilocode.client.ui.list

import ai.kilocode.client.testing.rowLines
import ai.kilocode.client.ui.FadeText
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.util.registry.RegistryKeyDescriptor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.Dimension
import java.awt.image.BufferedImage
import javax.swing.JPanel
import kotlin.math.abs

/**
 * Row text that runs out of room is cut at the component edge and the cut is hidden under a fade into the
 * row background — never an ellipsis, and never a glyph left standing half-drawn.
 *
 * Both the cut and the fade happen at paint time, so these paint the renderer's own text components. A cut
 * is exactly the roomy render with its tail columns dropped — same glyphs in the same places — so comparing
 * a narrow render against a crop of a wide one tells a cut from an ellipsis without depending on font
 * metrics. Dividing the ink left inside the fade band by the ink the roomy render puts in those same
 * columns then measures the fade itself with the glyph shapes divided out.
 */
class ActiveListFadeTest : BasePlatformTestCase() {
    fun `test a clipped title is cut rather than ellipsed`() {
        disableFade()
        val (title, _) = rendered(Row(LONG))

        assertNull("with the fade off the row must hand its text no backdrop", title.backdrop)
        // Byte-for-byte the roomy render minus the columns past the edge. An ellipsis has to repaint the
        // tail, so it could never match; nor could a re-layout that shortened the text to fit.
        assertTrue(
            "a cut title must be the roomy render with its tail columns dropped",
            same(paint(title, NARROW), crop(paint(title, WIDE), NARROW)),
        )
    }

    fun `test a clipped title fades into the row background`() {
        val (title, _) = rendered(Row(LONG))

        assertFaded(title)
    }

    fun `test the note beside a title fades too`() {
        val (title, _) = rendered(Row("name", note = LONG))

        // The note is the fragment that runs out of room here, and it is cut and faded like any other.
        assertFaded(title)
    }

    fun `test a clipped description fades like the title above it`() {
        val (_, desc) = rendered(Row("name", description = LONG))

        assertFaded(desc)
    }

    fun `test text with room to spare is left alone`() {
        val (title, _) = rendered(Row("short"))

        // The fade is for text that was cut. Given more room than it needs, the title must paint exactly
        // what it painted before — no band of background eating the glyphs that did fit.
        assertTrue(same(paint(title, WIDE), crop(paint(title, WIDE * 2), WIDE)))
    }

    /**
     * Asserts [component] fades over the trailing [UiStyle.Fade.width] of a narrow render: the text before
     * the band untouched, the text inside it surviving where the band opens and all but gone where it
     * closes.
     */
    private fun assertFaded(component: FadeText) {
        val backdrop = component.backdrop ?: error("the row must hand its text the color it painted behind it")
        val narrow = paint(component, NARROW)
        val roomy = crop(paint(component, WIDE), NARROW)
        val band = UiStyle.Fade.width()
        val edge = NARROW - band
        val mid = edge + band / 2

        assertFalse("a clipped line must not paint as a bare cut", same(narrow, roomy))
        assertTrue(
            "the fade reached text it should have left alone",
            same(crop(narrow, edge), crop(roomy, edge)),
        )
        // Divided by the roomy render's own ink column for column, so this measures the gradient rather
        // than which glyph happens to land where the band opens.
        val opening = attenuation(narrow, roomy, edge, mid, backdrop)
        val closing = attenuation(narrow, roomy, mid, NARROW, backdrop)
        assertTrue("the text is already gone where the fade opens: $opening", opening > 0.5)
        assertTrue("the fade does not deepen toward the edge: $opening then $closing", closing * 2 < opening)
    }

    /** How much of the roomy render's ink survives in columns [from] until [to] of the faded render. */
    private fun attenuation(faded: BufferedImage, roomy: BufferedImage, from: Int, to: Int, backdrop: Color): Double {
        val base = ink(roomy, from, to, backdrop)
        assertTrue("no text in columns $from..$to to measure a fade against", base > 0)
        return ink(faded, from, to, backdrop).toDouble() / base
    }

    /** Total per-channel distance from [backdrop] across columns [from] until [to] — the ink on the band. */
    private fun ink(image: BufferedImage, from: Int, to: Int, backdrop: Color): Long {
        var sum = 0L
        for (x in from until to) {
            for (y in 0 until image.height) {
                val rgb = image.getRGB(x, y)
                sum += abs(((rgb shr 16) and 0xFF) - backdrop.red)
                sum += abs(((rgb shr 8) and 0xFF) - backdrop.green)
                sum += abs((rgb and 0xFF) - backdrop.blue)
            }
        }
        return sum
    }

    /**
     * The row's title and description components, as a real list configures them. Both are matched against
     * the row they were rendered for rather than taken by position, so a renderer that swapped the two
     * lines would fail here instead of quietly measuring the wrong one.
     */
    private fun rendered(row: ActiveListItem): Pair<FadeText, FadeText> {
        val view = settle()
        view.update(listOf(row))
        val list = view.list
        val comp = list.cellRenderer.getListCellRendererComponent(list, list.model.getElementAt(0), 0, false, false)
        val (title, desc) = rowLines(comp)
        assertTrue("the first line must be the title: $title", title.toString().startsWith(row.title))
        assertEquals(row.description.orEmpty(), desc.toString())
        return title to desc
    }

    /**
     * [component] painted at [width] over the flat color it fades into, always at the same height so crops
     * of two renders line up. Deliberately an unscaled image rather than `UIUtil.createImage`, whose HiDPI
     * backing would make a pixel column and a layout column different things and break the arithmetic.
     */
    private fun paint(component: FadeText, width: Int): BufferedImage {
        component.size = Dimension(width, HEIGHT)
        component.doLayout()
        val image = BufferedImage(width, HEIGHT, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            canvas.color = component.backdrop ?: UIUtil.getListBackground(false, false)
            canvas.fillRect(0, 0, width, HEIGHT)
            component.paint(canvas)
        } finally {
            canvas.dispose()
        }
        return image
    }

    private fun crop(image: BufferedImage, width: Int): BufferedImage = image.getSubimage(0, 0, width, image.height)

    private fun same(a: BufferedImage, b: BufferedImage): Boolean {
        if (a.width != b.width || a.height != b.height) return false
        for (x in 0 until a.width) {
            for (y in 0 until a.height) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) return false
            }
        }
        return true
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

    /** Turns the fade off for one test. The key ships with the plugin, which unit tests do not load. */
    private fun disableFade() {
        Registry.mutateContributedKeys {
            it + (FLAG to RegistryKeyDescriptor(FLAG, "Fade clipped list row text.", "true", false, false, null, null))
        }
        Disposer.register(testRootDisposable) { Registry.mutateContributedKeys { it - FLAG } }
        Registry.get(FLAG).setValue(false, testRootDisposable)
    }

    private class Row(
        override val title: String,
        override val note: String? = null,
        override val description: String? = null,
    ) : ActiveListItem {
        override val key get() = "row"
        override val search get() = title
    }

    private companion object {
        // No spaces, so a cut is guaranteed to land mid-glyph and every column of the fade band carries ink.
        val LONG = "M".repeat(120)
        const val FLAG = "kilo.list.fade"
        const val NARROW = 120
        const val WIDE = 4000
        const val HEIGHT = 24
    }
}
