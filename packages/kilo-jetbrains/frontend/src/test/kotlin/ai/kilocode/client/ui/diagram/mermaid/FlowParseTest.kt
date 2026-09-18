package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Head
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FlowParseTest {
    @Test
    fun `header sets direction`() {
        assertEquals(Dir.Down, graph("graph TD\n A --> B").dir)
        assertEquals(Dir.Down, graph("graph TB\n A --> B").dir)
        assertEquals(Dir.Up, graph("graph BT\n A --> B").dir)
        assertEquals(Dir.Right, graph("flowchart LR\n A --> B").dir)
        assertEquals(Dir.Left, graph("flowchart RL\n A --> B").dir)
    }

    @Test
    fun `node shapes are recognised`() {
        val source = """
            flowchart TD
              a[Rect] --> b(Round)
              c([Stadium]) --> d[[Sub]]
              e[(Cyl)] --> f((Circle))
              g{Rhombus} --> h{{Hex}}
              i[/Skew/] --> j[\SkewAlt\]
              k[/Trap\] --> l[\TrapAlt/]
              m>Flag] --> n(((Doubled)))
        """
        val nodes = graph(source).nodes

        assertEquals(Shape.Rect, nodes.getValue("a").shape)
        assertEquals(Shape.Round, nodes.getValue("b").shape)
        assertEquals(Shape.Stadium, nodes.getValue("c").shape)
        assertEquals(Shape.Subroutine, nodes.getValue("d").shape)
        assertEquals(Shape.Cylinder, nodes.getValue("e").shape)
        assertEquals(Shape.Circle, nodes.getValue("f").shape)
        assertEquals(Shape.Rhombus, nodes.getValue("g").shape)
        assertEquals(Shape.Hexagon, nodes.getValue("h").shape)
        assertEquals(Shape.Skew, nodes.getValue("i").shape)
        assertEquals(Shape.SkewAlt, nodes.getValue("j").shape)
        assertEquals(Shape.Trapezoid, nodes.getValue("k").shape)
        assertEquals(Shape.TrapezoidAlt, nodes.getValue("l").shape)
        assertEquals(Shape.Flag, nodes.getValue("m").shape)
        assertEquals(Shape.Doubled, nodes.getValue("n").shape)
    }

    @Test
    fun `labels keep declaration order and break into lines`() {
        val graph = graph("flowchart TD\n A --> B\n B[\"Second<br/>line\"]")

        assertEquals(listOf("A", "B"), graph.nodes.keys.toList())
        assertEquals(listOf("A"), graph.nodes.getValue("A").label)
        assertEquals(listOf("Second", "line"), graph.nodes.getValue("B").label)
    }

    @Test
    fun `link styles and heads are classified`() {
        val edges = graph(
            """
            flowchart TD
              A --> B
              A --- C
              A -.-> D
              A ==> E
              A --o F
              A --x G
              A <--> H
            """,
        ).edges

        assertEquals(Link.Solid to Head.Arrow, edges[0].link to edges[0].head)
        assertEquals(Link.Solid to Head.None, edges[1].link to edges[1].head)
        assertEquals(Link.Dotted to Head.Arrow, edges[2].link to edges[2].head)
        assertEquals(Link.Thick to Head.Arrow, edges[3].link to edges[3].head)
        assertEquals(Link.Solid to Head.Dot, edges[4].link to edges[4].head)
        assertEquals(Link.Solid to Head.Cross, edges[5].link to edges[5].head)
        assertEquals(Head.Arrow, edges[6].tail)
    }

    @Test
    fun `edge labels come from pipes and inline text`() {
        val edges = graph(
            """
            flowchart TD
              A -->|yes| B
              A -- maybe --> C
              A -. later .-> D
              A == fast ==> E
            """,
        ).edges

        assertEquals(listOf("yes"), edges[0].label)
        assertEquals(listOf("maybe"), edges[1].label)
        assertEquals(listOf("later"), edges[2].label)
        assertEquals(listOf("fast"), edges[3].label)
        assertEquals(Link.Dotted, edges[2].link)
        assertEquals(Link.Thick, edges[3].link)
    }

    @Test
    fun `chains and ampersand groups expand into edges`() {
        val edges = graph("flowchart TD\n A --> B --> C\n X --> Y & Z").edges

        assertEquals(listOf("A" to "B", "B" to "C", "X" to "Y", "X" to "Z"), edges.map { it.from to it.to })
    }

    @Test
    fun `dashes inside labels do not split statements`() {
        val graph = graph("flowchart TD\n A[\"a --> b\"] --> B")

        assertEquals(1, graph.edges.size)
        assertEquals(listOf("a --> b"), graph.nodes.getValue("A").label)
    }

    @Test
    fun `subgraphs nest and assign membership`() {
        val graph = graph(
            """
            flowchart TD
              Client --> Gate
              subgraph core [Core]
                Gate --> Auth
                subgraph store [Store]
                  Auth --> Db
                end
              end
        """,
        )

        assertEquals(listOf("core", "store"), graph.clusters.keys.toList())
        assertEquals(listOf("Core"), graph.clusters.getValue("core").label)
        assertNull(graph.clusters.getValue("core").parent)
        assertEquals("core", graph.clusters.getValue("store").parent)
        assertNull(graph.nodes.getValue("Client").cluster)
        assertEquals("core", graph.nodes.getValue("Gate").cluster)
        assertEquals("core", graph.nodes.getValue("Auth").cluster)
        assertEquals("store", graph.nodes.getValue("Db").cluster)
    }

    @Test
    fun `a node mentioned before a subgraph still joins it`() {
        val graph = graph(
            """
            flowchart TD
              Client --> Gateway
              subgraph core [Core]
                Gateway --> Auth
              end
              Gateway[API Gateway] --> Report
        """,
        )

        assertEquals("core", graph.nodes.getValue("Gateway").cluster)
        assertEquals(listOf("API Gateway"), graph.nodes.getValue("Gateway").label)
        assertNull(graph.nodes.getValue("Report").cluster)
    }

    @Test
    fun `the first subgraph to mention a node wins`() {
        val graph = graph(
            """
            flowchart TD
              subgraph one [One]
                A --> B
              end
              subgraph two [Two]
                B --> C
              end
        """,
        )

        assertEquals("one", graph.nodes.getValue("B").cluster)
        assertEquals("two", graph.nodes.getValue("C").cluster)
    }

    @Test
    fun `styling statements are skipped and class suffixes dropped`() {
        val graph = graph(
            """
            flowchart TD
              classDef hot fill:#f00
              A:::hot --> B
              class B hot
              style A stroke:#000
              click A "https://example.com"
              linkStyle 0 stroke:#0f0
        """,
        )

        assertEquals(listOf("A", "B"), graph.nodes.keys.toList())
        assertEquals(1, graph.edges.size)
    }

    @Test
    fun `self links are preserved`() {
        val edges = graph("flowchart TD\n A --> A").edges

        assertEquals(1, edges.size)
        assertTrue(edges.single().from == edges.single().to)
    }

    @Test
    fun `dangling subgraph and stray end are reported with line numbers`() {
        val open = runBlocking { Flow().parse(Source.clean("flowchart TD\n subgraph s\n  A --> B")) }
        val stray = runBlocking { Flow().parse(Source.clean("flowchart TD\n A --> B\n end")) }

        assertEquals(3, (open as FlowOut.Err).line)
        assertEquals(3, (stray as FlowOut.Err).line)
    }

    private fun graph(source: String): Graph {
        val out = runBlocking { Flow().parse(Source.clean(source.trimIndent())) }
        assertTrue(out is FlowOut.Ok, "expected a parsed graph but was $out")
        return (out as FlowOut.Ok).graph
    }
}
