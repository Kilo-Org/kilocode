package ai.kilocode.client.ui.md

import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.TextRange
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.text.JTextComponent

class MdViewSearchTest : BasePlatformTestCase() {
    private lateinit var view: MdView

    override fun setUp() {
        super.setUp()
        view = MdViewFactory.hybrid()
    }

    override fun tearDown() {
        try {
            if (this::view.isInitialized) Disposer.dispose(view)
        } finally {
            super.tearDown()
        }
    }

    fun `test prose inline code and tables are searchable but fenced code is excluded`() {
        view.set(
            """
            # Heading

            inline `code` here

            ```kotlin
            topsecret()
            ```

            - item with inline text

              ```
              nestedsecret
              ```

            | A | B |
            |---|---|
            | cell | value |
            """.trimIndent(),
        )

        val all = view.searchBlocks().joinToString("\n") { it.text }

        assertTrue(all.contains("Heading"))
        assertTrue(all.contains("inline code here"))
        assertTrue(all.contains("item with inline text"))
        assertTrue(all.contains("cell"))
        assertFalse(all.contains("topsecret"))
        assertFalse(all.contains("nestedsecret"))
    }

    fun `test excluded ranges cover nested fenced code`() {
        view.set(
            """
            - item

              ```
              hidden
              ```
            """.trimIndent(),
        )

        val block = view.searchBlocks().single { it.text.contains("item") }
        val hidden = block.text.indexOf("hidden")
        if (hidden >= 0) {
            assertTrue(
                "fenced code inside a list must be excluded",
                block.excluded.any { hidden >= it.startOffset && hidden < it.endOffset },
            )
        }
    }

    fun `test painter wraps the matched word instead of the line`() {
        view.set("hello target world")
        val block = view.searchBlocks().single()
        val pane = block.component as JTextComponent
        val host = JBScrollPane(view.component)
        host.setSize(420, 200)
        view.component.setSize(420, view.component.preferredSize.height)
        host.doLayout()
        view.component.doLayout()
        pane.doLayout()

        val plain = paint(pane)
        val start = block.text.indexOf("target")
        val range = TextRange(start, start + "target".length)
        block.applyHighlights(listOf(range), null)
        val marked = paint(pane)

        val span = changed(plain, marked)
        assertTrue("search painter should mark the matched text", span != null)
        val rect = span!!
        val word = pane.modelToView2D(start)!!.bounds.union(
            pane.modelToView2D(range.endOffset - 1)!!.bounds,
        )

        assertEquals("highlight should start at the matched word", word.x.toDouble(), rect.x.toDouble(), 2.0)
        assertEquals("highlight should cover the matched word", word.width.toDouble(), rect.width.toDouble(), 2.0)
        assertTrue(
            "painted highlight should wrap the word, not the whole line: span=${rect.width} pane=${pane.width}",
            rect.width < pane.width / 2,
        )
    }

    private fun paint(pane: JTextComponent): BufferedImage {
        val image = BufferedImage(pane.width, pane.height, BufferedImage.TYPE_INT_RGB)
        val g = image.createGraphics()
        try {
            pane.paint(g)
        } finally {
            g.dispose()
        }
        return image
    }

    private fun changed(plain: BufferedImage, marked: BufferedImage): Rectangle? {
        var left = Int.MAX_VALUE
        var right = Int.MIN_VALUE
        var top = Int.MAX_VALUE
        var bottom = Int.MIN_VALUE
        for (y in 0 until plain.height) {
            for (x in 0 until plain.width) {
                if (plain.getRGB(x, y) == marked.getRGB(x, y)) continue
                if (x < left) left = x
                if (x > right) right = x
                if (y < top) top = y
                if (y > bottom) bottom = y
            }
        }
        if (right < left) return null
        return Rectangle(left, top, right - left + 1, bottom - top + 1)
    }

    fun `test highlights are search owned and can be cleared`() {
        view.set("hello target world")
        val block = view.searchBlocks().single()
        val start = block.text.indexOf("target")
        val range = TextRange(start, start + "target".length)

        val pane = block.component as JTextComponent
        pane.select(0, 5)
        block.applyHighlights(listOf(range), range)
        assertEquals(2, pane.highlighter.highlights.size)
        assertEquals(0, pane.selectionStart)
        assertEquals(5, pane.selectionEnd)

        view.clearSearchHighlights()
        assertEquals(0, pane.highlighter.highlights.size)
    }

    fun `test repeated streaming updates keep highlight tags bounded`() {
        view.set("target")
        repeat(50) {
            view.append(" target")
            val block = view.searchBlocks().single()
            block.applyHighlights(listOf(TextRange(0, 1)), null)
        }

        val pane = view.searchBlocks().single().component as JTextComponent
        assertEquals(1, pane.highlighter.highlights.size)
    }

    fun `test highlight tags are capped per block while current match stays visible`() {
        view.set("x".repeat(MAX_SEARCH_HIGHLIGHTS + 100))
        val block = view.searchBlocks().single()
        val ranges = (0 until MAX_SEARCH_HIGHLIGHTS + 100).map { TextRange(it, it + 1) }

        block.applyHighlights(ranges, ranges.last())

        val pane = block.component as JTextComponent
        assertEquals(MAX_SEARCH_HIGHLIGHTS + 1, pane.highlighter.highlights.size)
    }

    fun `test streaming updates do not clear existing highlights`() {
        view.set("target")
        val block = view.searchBlocks().single()
        block.applyHighlights(listOf(TextRange(0, 1)), null)

        view.append(" target")

        val pane = view.searchBlocks().single().component as JTextComponent
        assertEquals(1, pane.highlighter.highlights.size)
    }

    fun `test document replacement notifies search listeners`() {
        var count = 0
        val listener = MdSearchView.SearchListener { count++ }
        view.set("first")
        view.addSearchListener(listener)
        view.set("second")
        view.removeSearchListener(listener)

        assertTrue(count > 0)
        assertEquals("second", view.markdown())
    }
}