package ai.kilocode.client.ui.md

import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.TextRange
import com.intellij.testFramework.fixtures.BasePlatformTestCase
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

        val all = view.searchSurfaces().joinToString("\n") { it.text }

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

        val surface = view.searchSurfaces().single { it.text.contains("item") }
        val hidden = surface.text.indexOf("hidden")
        if (hidden >= 0) {
            assertTrue(
                "fenced code inside a list must be excluded",
                surface.excluded.any { hidden >= it.startOffset && hidden < it.endOffset },
            )
        }
    }

    fun `test highlights are search owned and can be cleared`() {
        view.set("hello target world")
        val surface = view.searchSurfaces().single()
        val start = surface.text.indexOf("target")
        val range = TextRange(start, start + "target".length)

        val pane = surface.component as JTextComponent
        pane.select(0, 5)
        view.applySearchHighlights(mapOf(surface.id to MdSearchView.SearchHighlights(listOf(range), range)))
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
            val surface = view.searchSurfaces().single()
            view.applySearchHighlights(
                mapOf(surface.id to MdSearchView.SearchHighlights(listOf(TextRange(0, 1)), null)),
            )
        }

        val pane = view.searchSurfaces().single().component as JTextComponent
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