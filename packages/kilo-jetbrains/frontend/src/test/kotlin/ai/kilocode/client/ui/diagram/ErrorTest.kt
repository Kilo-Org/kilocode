package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class ErrorTest {
    private val engine = Mermaid(FakeMeasure())

    @Test
    fun `unsupported diagram types are rejected without parsing`() {
        val out = draw("zenuml\n A->B: hi")

        assertEquals(Fault.Unsupported, err(out).fault)
    }

    @Test
    fun `unknown keywords are unsupported`() {
        assertEquals(Fault.Unsupported, err(draw("hello world")).fault)
        assertEquals(Fault.Unsupported, err(draw("")).fault)
    }

    @Test
    fun `syntax errors report the original line number`() {
        val out = draw("flowchart TD\n  A --> B\n  end")

        assertEquals(Fault.Syntax, err(out).fault)
        assertEquals(3, err(out).line)
    }

    @Test
    fun `line numbers survive frontmatter and comments`() {
        val out = draw("---\ntitle: Demo\n---\n%% a note\nflowchart TD\n  A --> B\n  end")

        assertEquals(7, err(out).line)
    }

    @Test
    fun `empty diagrams are a syntax error rather than an empty scene`() {
        assertEquals(Fault.Syntax, err(draw("flowchart TD")).fault)
        assertEquals(Fault.Syntax, err(draw("sequenceDiagram")).fault)
    }

    @Test
    fun `sequence blocks report unbalanced ends`() {
        val out = draw("sequenceDiagram\n  A->>B: hi\n  end")

        assertEquals(Fault.Syntax, err(out).fault)
        assertEquals(3, err(out).line)
    }

    private fun draw(source: String) = runBlocking { engine.draw(source, spec()) }
}
