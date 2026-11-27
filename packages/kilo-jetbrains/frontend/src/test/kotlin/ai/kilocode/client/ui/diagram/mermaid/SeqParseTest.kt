package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Head
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SeqParseTest {
    @Test
    fun `declared participants keep order and aliases`() {
        val script = script("sequenceDiagram\n participant C as Client\n actor S as Server\n C->>S: hi")

        assertEquals(listOf("C", "S"), script.actors.keys.toList())
        assertEquals(listOf("Client"), script.actors.getValue("C").label)
        assertEquals(listOf("Server"), script.actors.getValue("S").label)
    }

    @Test
    fun `the as separator is case insensitive`() {
        val script = script("sequenceDiagram\n PARTICIPANT C AS Client\n C->>S: hi")

        assertEquals(listOf("C", "S"), script.actors.keys.toList())
        assertEquals(listOf("Client"), script.actors.getValue("C").label)
    }

    @Test
    fun `quoted participant ids match unquoted usages`() {
        val script = script("sequenceDiagram\n participant \"Alice\"\n Alice->>Bob: hi")

        assertEquals(listOf("Alice", "Bob"), script.actors.keys.toList())
        assertEquals(listOf("Alice"), script.actors.getValue("Alice").label)
    }

    @Test
    fun `as inside a quoted name is not an alias`() {
        val script = script("sequenceDiagram\n participant \"Bob as builder\"\n")

        assertEquals(listOf("Bob as builder"), script.actors.keys.toList())
    }

    @Test
    fun `undeclared participants appear in first use order`() {
        val script = script("sequenceDiagram\n B->>A: first\n A->>C: second")

        assertEquals(listOf("B", "A", "C"), script.actors.keys.toList())
    }

    @Test
    fun `arrow forms map to link styles and heads`() {
        val steps = script(
            """
            sequenceDiagram
              A->>B: solid arrow
              A-->>B: dotted arrow
              A->B: solid open
              A-->B: dotted open
              A-xB: solid cross
              A--xB: dotted cross
              A-)B: solid dot
            """,
        ).steps.filterIsInstance<Step.Msg>()

        assertEquals(Link.Solid to Head.Arrow, steps[0].link to steps[0].head)
        assertEquals(Link.Dotted to Head.Arrow, steps[1].link to steps[1].head)
        assertEquals(Link.Solid to Head.Open, steps[2].link to steps[2].head)
        assertEquals(Link.Dotted to Head.Open, steps[3].link to steps[3].head)
        assertEquals(Link.Solid to Head.Cross, steps[4].link to steps[4].head)
        assertEquals(Link.Dotted to Head.Cross, steps[5].link to steps[5].head)
        assertEquals(Link.Solid to Head.Dot, steps[6].link to steps[6].head)
    }

    @Test
    fun `participant names may contain dashes`() {
        val steps = script("sequenceDiagram\n web-app->>db-main: query").steps.filterIsInstance<Step.Msg>()

        assertEquals("web-app", steps.single().from)
        assertEquals("db-main", steps.single().to)
    }

    @Test
    fun `activation shorthand wraps the message`() {
        val steps = script("sequenceDiagram\n A->>+B: open\n B-->>-A: close").steps

        assertEquals(Step.Toggle("B", true), steps[0])
        assertTrue(steps[1] is Step.Msg)
        assertTrue(steps[2] is Step.Msg)
        assertEquals(Step.Toggle("B", false), steps[3])
    }

    @Test
    fun `explicit activate and deactivate are recorded`() {
        val steps = script("sequenceDiagram\n activate A\n A->>B: work\n deactivate A").steps

        assertEquals(Step.Toggle("A", true), steps[0])
        assertEquals(Step.Toggle("A", false), steps[2])
    }

    @Test
    fun `notes carry placement and targets`() {
        val notes = script(
            """
            sequenceDiagram
              participant A
              participant B
              Note left of A: left side
              Note right of B: right side
              Note over A,B: spanning
            """,
        ).steps.filterIsInstance<Step.Note>()

        assertEquals(NoteAt.Left, notes[0].at)
        assertEquals(listOf("A"), notes[0].actors)
        assertEquals(listOf("left side"), notes[0].label)
        assertEquals(NoteAt.Right, notes[1].at)
        assertEquals(NoteAt.Over, notes[2].at)
        assertEquals(listOf("A", "B"), notes[2].actors)
    }

    @Test
    fun `blocks open split and close`() {
        val steps = script(
            """
            sequenceDiagram
              alt in stock
                A->>B: reserve
              else sold out
                A->>B: refuse
              end
              loop twice
                A->>B: retry
              end
        """,
        ).steps

        assertEquals(Step.Open(BlockKind.Alt, listOf("in stock")), steps[0])
        assertEquals(Step.Split(listOf("sold out")), steps[2])
        assertEquals(Step.Close, steps[4])
        assertEquals(Step.Open(BlockKind.Loop, listOf("twice")), steps[5])
    }

    @Test
    fun `title and autonumber are captured`() {
        val script = script("sequenceDiagram\n title Checkout\n autonumber\n A->>B: go")

        assertEquals(listOf("Checkout"), script.title)
        assertTrue(script.numbered)
    }

    @Test
    fun `unbalanced blocks are reported with line numbers`() {
        val open = runBlocking { Seq().parse(Source.clean("sequenceDiagram\n loop forever\n  A->>B: x")) }
        val stray = runBlocking { Seq().parse(Source.clean("sequenceDiagram\n A->>B: x\n end")) }

        assertEquals(3, (open as SeqOut.Err).line)
        assertEquals(3, (stray as SeqOut.Err).line)
    }

    private fun script(source: String): Script {
        val out = runBlocking { Seq().parse(Source.clean(source.trimIndent())) }
        assertTrue(out is SeqOut.Ok, "expected a parsed script but was $out")
        return (out as SeqOut.Ok).script
    }
}
