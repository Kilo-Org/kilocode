package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Model output can be pathological; the engine must refuse rather than hang or exhaust memory. */
class LimitsTest {
    private val engine = Mermaid(FakeMeasure())

    @Test
    fun `character cap is enforced before preprocessing`() {
        val source = "flowchart TD\n  A --> B"
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(chars = 10))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    /** A single line can fan out to n*m links, so the cap has to bite while the edges are built. */
    @Test
    fun `ampersand fan out is capped as it expands`() {
        val left = (1..40).joinToString(" & ") { "a$it" }
        val right = (1..40).joinToString(" & ") { "b$it" }
        val out = runBlocking { engine.draw("flowchart TD\n $left --> $right", spec().copy(limits = Limits(edges = 5))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    @Test
    fun `line cap is enforced before parsing`() {
        val source = "flowchart TD\n" + (1..50).joinToString("\n") { "  n$it --> n${it + 1}" }
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(lines = 10))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    @Test
    fun `node cap is enforced`() {
        val source = "flowchart TD\n" + (1..30).joinToString("\n") { "  n$it --> n${it + 1}" }
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(nodes = 5))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    @Test
    fun `link cap is enforced`() {
        val source = "flowchart TD\n" + (1..30).joinToString("\n") { "  a --> n$it" }
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(edges = 5))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    @Test
    fun `sequence caps are enforced`() {
        val source = "sequenceDiagram\n" + (1..30).joinToString("\n") { "  a->>b: step $it" }
        val steps = runBlocking { engine.draw(source, spec().copy(limits = Limits(edges = 5))) }
        val actors = "sequenceDiagram\n" + (1..30).joinToString("\n") { "  a->>p$it: step" }
        val people = runBlocking { engine.draw(actors, spec().copy(limits = Limits(nodes = 5))) }

        assertEquals(Fault.Limit, err(steps).fault)
        assertEquals(Fault.Limit, err(people).fault)
    }

    /** One line is the unit of uninterruptible work, so it needs a cap of its own. */
    @Test
    fun `single line cap is enforced`() {
        val source = "flowchart TD\n  A[" + "x".repeat(200) + "] --> B"
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(span = 50))) }

        assertEquals(Fault.Limit, err(out).fault)
        assertTrue(err(out).message.contains("50"))
    }

    @Test
    fun `a long source of short lines is not refused by the line span cap`() {
        val source = "flowchart TD\n" + (1..20).joinToString("\n") { "  n$it --> n${it + 1}" }
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(span = 40))) }

        assertTrue(scene(out).marks.isNotEmpty())
    }

    @Test
    fun `a graph at the cap still renders`() {
        val source = "flowchart TD\n" + (1..9).joinToString("\n") { "  n$it --> n${it + 1}" }
        val out = runBlocking { engine.draw(source, spec().copy(limits = Limits(nodes = 10, edges = 9))) }

        assertEquals(10, scene(out).marks.count { it is Mark.Box })
    }

    /**
     * Subgraph nesting is capped only by the line limit, so a frame's members and depth have to be
     * resolved in one pass. Walking the cluster tree per cluster rescans every node per cluster, which
     * turns a few hundred levels into a stall in a phase that cannot be cancelled cheaply.
     */
    @Test
    fun `deeply nested subgraphs still render`() {
        val depth = 200
        val open = (1..depth).joinToString("\n") { "  subgraph s$it" }
        val close = (1..depth).joinToString("\n") { "  end" }
        val out = runBlocking { engine.draw("flowchart TD\n$open\n  a --> b\n$close", spec()) }

        assertEquals(depth, scene(out).marks.count { it is Mark.Group })
    }
}
