package ai.kilocode.client.ui.md

import ai.kilocode.client.ui.md.hybrid.Desc
import ai.kilocode.client.ui.md.hybrid.Kind
import ai.kilocode.client.ui.md.hybrid.MdProjector
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdProjectorTest : BasePlatformTestCase() {
    private val projector = MdProjector()

    fun `test prose coalesces and thematic breaks are filtered`() {
        val out = projector.project("# Title\n\nfirst\n\n---\n\n- item")

        assertEquals(1, out.blocks.size)
        val html = out.blocks.single() as Desc.Html
        assertTrue(html.body.contains("<h1>"))
        assertTrue(html.body.contains("<ul>"))
        assertFalse(html.body.contains("<hr"))
        assertFalse(out.html.contains("<hr"))
    }

    fun `test fenced and indented code become code descs`() {
        val out = projector.project("before\n\n```kotlin\nval x = 1\n```\n\n    indented")

        assertTrue(out.blocks[0] is Desc.Html)
        val fenced = out.blocks[1] as Desc.Code
        val indented = out.blocks[2] as Desc.Code

        assertEquals("val x = 1\n", fenced.text)
        assertEquals("indented\n", indented.text)
        assertSame(PlainTextFileType.INSTANCE, (indented.kind as Kind.Source).file)
        assertTrue(out.html.contains("<pre><code>val x = 1\n</code></pre>"))
    }

    fun `test table is extracted as its own block`() {
        val out = projector.project("intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\noutro")

        assertTrue(out.blocks[0] is Desc.Html)
        assertTrue(out.blocks[1] is Desc.Table)
        assertTrue(out.blocks[2] is Desc.Html)
        assertTrue((out.blocks[1] as Desc.Table).body.contains("<table>"))
    }

    fun `test partial opener renders empty code block`() {
        val out = projector.project("``")

        assertEquals(listOf(Desc.Code("", Kind.Source(PlainTextFileType.INSTANCE))), out.blocks)
        assertEquals("<pre><code></code></pre>\n", out.html)
        assertNull(out.open)
    }

    fun `test language prefix split stays out of code text`() {
        val out = projector.project("```python\nprint(1)\n")
        val code = out.blocks.single() as Desc.Code

        assertEquals("print(1)\n", code.text)
        assertFalse(out.html.contains("python"))
        assertEquals('`', out.open!!.char)
    }

    fun `test partial closer is trimmed and complete closer closes`() {
        val partial = projector.project("```python\nprint(1)\n``")
        val complete = projector.project("```python\nprint(1)\n```\n\nafter")

        assertEquals("print(1)\n", (partial.blocks.single() as Desc.Code).text)
        assertNull(partial.open)
        assertEquals(2, complete.blocks.size)
        assertEquals("print(1)\n", (complete.blocks[0] as Desc.Code).text)
        assertTrue((complete.blocks[1] as Desc.Html).body.contains("after"))
    }
}
