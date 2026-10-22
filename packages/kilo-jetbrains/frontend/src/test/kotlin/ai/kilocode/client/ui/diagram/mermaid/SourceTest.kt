package ai.kilocode.client.ui.diagram.mermaid

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SourceTest {
    @Test
    fun `normalizes line endings and tabs`() {
        val clean = Source.clean("graph TD\r\n\tA --> B\r")

        assertEquals(listOf("graph TD", "    A --> B", ""), clean.lines.map { it.text })
        assertEquals(listOf(1, 2, 3), clean.lines.map { it.at })
    }

    @Test
    fun `skips terminated frontmatter and keeps original line numbers`() {
        val clean = Source.clean("---\ntitle: Demo\n---\ngraph TD\n  A --> B")

        assertEquals(listOf("graph TD", "  A --> B"), clean.lines.map { it.text })
        assertEquals(listOf(4, 5), clean.lines.map { it.at })
    }

    @Test
    fun `unterminated frontmatter is treated as content`() {
        val clean = Source.clean("---\ntitle: Demo\ngraph TD")

        assertEquals(3, clean.lines.size)
        assertEquals(1, clean.lines.first().at)
    }

    @Test
    fun `line comments are cut but quoted percent signs survive`() {
        val clean = Source.clean("graph TD %% direction note\n  A[\"50%% done\"] --> B %% trailing")

        assertEquals("graph TD", clean.lines[0].text)
        assertEquals("  A[\"50%% done\"] --> B", clean.lines[1].text)
    }

    @Test
    fun `init directives are blanked without shifting line numbers`() {
        val clean = Source.clean("%%{init: {'theme':'dark'}}%%\ngraph TD\n  A --> B")

        assertTrue(clean.lines[0].text.isBlank())
        assertEquals("graph TD", clean.lines[1].text)
        assertEquals(2, clean.lines[1].at)
    }

    @Test
    fun `multi line directives keep the line map aligned`() {
        val clean = Source.clean("%%{init: {\n  'theme':'dark'\n}}%%\ngraph TD\n  end")

        assertEquals("graph TD", clean.lines[3].text)
        assertEquals(4, clean.lines[3].at)
        assertEquals(5, clean.lines[4].at)
    }

    @Test
    fun `an unterminated directive leaves the rest of the source intact`() {
        val clean = Source.clean("%%{init: {'theme':'dark'}\ngraph TD\n  A --> B")

        assertEquals(3, clean.lines.size)
        assertEquals("graph TD", clean.lines[1].text)
        assertEquals(2, clean.lines[1].at)
    }

    /** A lazy `%%\{[\s\S]*?}%%` regex rescans to the end of the text per opener; this would stall. */
    @Test
    fun `many unterminated directives do not stall preprocessing`() {
        val clean = Source.clean("%%{".repeat(50_000) + "\ngraph TD\n  A --> B")

        assertEquals("graph TD", clean.lines[1].text)
    }

    @Test
    fun `labels split on break forms and drop quotes`() {
        assertEquals(listOf("one", "two"), Source.label("\"one<br/>two\""))
        assertEquals(listOf("a", "b"), Source.label("a<br>b"))
        assertEquals(listOf("a", "b"), Source.label("a<br />b"))
        assertEquals(listOf("a", "b"), Source.label("a\\nb"))
        assertEquals(listOf(""), Source.label("   "))
    }

    @Test
    fun `opens reports bracket and quote nesting`() {
        val text = "A[x --> y] --> B"
        val mask = Source.opens(text)

        assertTrue(mask[text.lastIndexOf("-->")])
        assertTrue(!mask[text.indexOf("-->")])
    }

    @Test
    fun `opens treats bracketed and quoted regions as closed`() {
        // The flag is the state *before* each character, so an opening quote or bracket is still open and
        // its closing partner is not.
        val mask = Source.opens("a\"b\"c(d)e")

        assertEquals(
            listOf(true, true, false, false, true, true, false, false, true),
            mask.toList(),
        )
    }

    /** Answering "is this index open" per index rescans from 0 each time, which stalls on a long line. */
    @Test
    fun `opens scans a long line in one pass`() {
        val text = "A".repeat(200_000) + "-->B"
        val mask = Source.opens(text)

        assertEquals(text.length, mask.size)
        assertTrue(mask.all { it })
    }
}
