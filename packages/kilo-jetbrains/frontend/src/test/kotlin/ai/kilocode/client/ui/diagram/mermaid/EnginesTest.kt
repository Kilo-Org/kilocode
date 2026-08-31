package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.FakeMeasure
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Head
import ai.kilocode.client.ui.diagram.Limits
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.err
import ai.kilocode.client.ui.diagram.flatten
import ai.kilocode.client.ui.diagram.scene
import ai.kilocode.client.ui.diagram.spec
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Behaviour of the engines added on top of Flow and Seq, one section per diagram family. */
class EnginesTest {
    private val engine = Mermaid(FakeMeasure())

    // --- class ---

    @Test
    fun `class inheritance draws a hollow triangle at the parent end`() {
        val scene = scene(draw("classDiagram\n Shape <|-- Circle"))
        val edge = flatten(scene.marks).filterIsInstance<Mark.Edge>().single { it.role == Role.Line }

        assertEquals(Head.Triangle, edge.tail)
        assertEquals(Head.None, edge.head)
    }

    @Test
    fun `class relation keeps cardinality and label`() {
        val scene = scene(draw("classDiagram\n Canvas o-- \"0..*\" Shape : holds"))
        val texts = texts(scene)

        assertTrue(texts.contains("0..*"), "missing cardinality in $texts")
        assertTrue(texts.contains("holds"), "missing label in $texts")
    }

    @Test
    fun `class members split into attribute and operation compartments`() {
        val scene = scene(draw("classDiagram\n class A {\n +int x\n +go() void\n }"))
        val texts = texts(scene)

        assertTrue(texts.containsAll(listOf("A", "+int x", "+go() void")), "missing members in $texts")
    }

    @Test
    fun `class block without closing brace is a syntax error`() {
        assertEquals(Fault.Syntax, err(draw("classDiagram\n class A {\n +x")).fault)
    }

    // --- state ---

    @Test
    fun `state diagram renders start and end markers`() {
        val scene = scene(draw("stateDiagram-v2\n [*] --> A\n A --> [*]"))
        val ovals = flatten(scene.marks).filterIsInstance<Mark.Oval>()

        assertTrue(ovals.count { it.fill == Role.Line } >= 2, "missing start/end dots")
    }

    @Test
    fun `composite states nest their members`() {
        val scene = scene(draw("stateDiagram-v2\n [*] --> Run\n state Run {\n [*] --> Work\n }"))
        val texts = texts(scene)

        assertTrue(texts.contains("Run") && texts.contains("Work"), "missing states in $texts")
    }

    // --- er ---

    @Test
    fun `er cardinalities map to crows feet`() {
        val scene = scene(draw("erDiagram\n A ||--o{ B : has"))
        val edge = flatten(scene.marks).filterIsInstance<Mark.Edge>().single { it.role == Role.Line }

        assertEquals(Head.Bar, edge.tail)
        assertEquals(Head.Crow, edge.head)
    }

    @Test
    fun `er attributes render inside the entity table`() {
        val scene = scene(draw("erDiagram\n A {\n int id PK\n }"))
        val texts = texts(scene)

        assertTrue(texts.contains("int") && texts.contains("id PK"), "missing attributes in $texts")
    }

    // --- requirement ---

    @Test
    fun `requirement relation labels the arrow with the keyword`() {
        val scene = scene(draw("requirementDiagram\n requirement r {\n id: 1\n }\n element e {\n type: module\n }\n e - satisfies -> r"))
        val texts = texts(scene)

        assertTrue(texts.contains("«satisfies»"), "missing relation label in $texts")
        assertTrue(texts.contains("«requirement»") && texts.contains("«element»"), "missing stereotypes in $texts")
    }

    // --- c4 ---

    @Test
    fun `c4 relation technology renders as a bracketed second line`() {
        val scene = scene(draw("C4Context\n System(a, \"A\", \"x\")\n System(b, \"B\", \"y\")\n Rel(a, b, \"Uses\", \"HTTPS\")"))
        val texts = texts(scene)

        assertTrue(texts.contains("Uses") && texts.contains("[HTTPS]"), "missing rel label in $texts")
    }

    @Test
    fun `c4 external systems get a dashed border`() {
        val scene = scene(draw("C4Context\n System_Ext(p, \"P\", \"x\")"))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>()

        assertTrue(boxes.any { it.dash }, "expected a dashed external box")
    }

    // --- pie ---

    @Test
    fun `pie renders one sector per slice and sorts by value`() {
        val scene = scene(draw("pie showData\n title T\n \"A\" : 10\n \"B\" : 30"))
        val sectors = flatten(scene.marks).filterIsInstance<Mark.Sector>()

        assertEquals(2, sectors.size)
        assertEquals(0, sectors.first().tone, "largest slice should get the first tone")
        assertTrue(texts(scene).contains("B [30]"), "showData should append values")
    }

    @Test
    fun `pie rejects non numeric values`() {
        assertEquals(Fault.Syntax, err(draw("pie\n \"A\" : x")).fault)
    }

    // --- journey ---

    @Test
    fun `journey plots one dot per task`() {
        val scene = scene(draw("journey\n title T\n section S\n Wake up: 3: Me\n Work: 5: Me"))
        val dots = flatten(scene.marks).filterIsInstance<Mark.Oval>()

        assertEquals(2, dots.size)
        assertTrue(texts(scene).contains("Wake up"))
    }

    // --- timeline ---

    @Test
    fun `timeline continuation lines join the previous period`() {
        val scene = scene(draw("timeline\n 2024 : Plugin API\n : Cloud sync\n 2025 : AI"))
        val texts = texts(scene)

        assertTrue(texts.containsAll(listOf("2024", "Plugin API", "Cloud sync", "2025", "AI")), "missing entries in $texts")
    }

    // --- kanban ---

    @Test
    fun `kanban strips card metadata`() {
        val scene = scene(draw("kanban\n  todo[To do]\n    t1[Ship it]@{ assigned: 'kb' }"))
        val texts = texts(scene)

        assertTrue(texts.contains("Ship it"), "missing card in $texts")
        assertTrue(texts.none { it.contains("@{") }, "metadata leaked into $texts")
    }

    // --- packet ---

    @Test
    fun `packet fields crossing a row boundary split`() {
        val scene = scene(draw("packet-beta\n 0-15: \"a\"\n 16-40: \"b\""))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>()

        assertEquals(3, boxes.size, "16-40 must split at bit 32")
    }

    // --- treemap ---

    @Test
    fun `treemap sums internal nodes from their leaves`() {
        val scene = scene(draw("treemap-beta\n\"root\"\n    \"a\": 30\n    \"b\": 10"))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.tone != null }

        assertEquals(2, boxes.size)
        val big = boxes.maxBy { it.rect.w * it.rect.h }
        val small = boxes.minBy { it.rect.w * it.rect.h }
        assertTrue(big.rect.w * big.rect.h > small.rect.w * small.rect.h * 2, "areas should follow values")
    }

    // --- block ---

    @Test
    fun `block cells honour columns and space slots`() {
        val scene = scene(draw("block-beta\n columns 3\n a space b\n space:3\n space c space\n a --> b"))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>()

        assertEquals(3, boxes.size)
        val a = boxes.first()
        val c = boxes.last()
        assertTrue(c.rect.x > a.rect.x, "c should sit in the middle column")
        assertTrue(c.rect.y > a.rect.y, "c should sit two rows down")
    }

    // --- mindmap ---

    @Test
    fun `mindmap rejects a second root`() {
        assertEquals(Fault.Syntax, err(draw("mindmap\n a\n b")).fault)
    }

    @Test
    fun `mindmap unwraps node shapes`() {
        val scene = scene(draw("mindmap\n  root((IDE))\n    (Editor)\n    [Tools]"))
        val texts = texts(scene)

        assertTrue(texts.containsAll(listOf("IDE", "Editor", "Tools")), "shape brackets leaked into $texts")
    }

    // --- xychart ---

    @Test
    fun `xychart draws bars and a line for each series`() {
        val scene = scene(draw("xychart-beta\n x-axis [a, b]\n y-axis \"Y\" 0 --> 10\n bar [1, 2]\n line [3, 4]"))
        val bars = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.tone != null }
        val lines = flatten(scene.marks).filterIsInstance<Mark.Edge>().filter { it.tone != null }

        assertEquals(2, bars.size)
        assertEquals(1, lines.size)
    }

    // --- quadrant ---

    @Test
    fun `quadrant places points inside the plot`() {
        val scene = scene(draw("quadrantChart\n quadrant-1 Q\n P: [0.5, 0.5]"))
        val zones = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.soft }

        assertEquals(4, zones.size)
        assertTrue(texts(scene).contains("P"))
    }

    // --- radar ---

    @Test
    fun `radar accepts key value curves`() {
        val scene = scene(draw("radar-beta\n axis a, b\n curve c{ b: 2, a: 1 }"))
        val fills = flatten(scene.marks).filterIsInstance<Mark.Poly>().filter { it.soft }

        assertEquals(1, fills.size)
    }

    // --- gantt ---

    @Test
    fun `gantt chains after tasks and renders milestones as diamonds`() {
        val source = """
            gantt
                dateFormat YYYY-MM-DD
                section S
                    First :a1, 2026-09-01, 10d
                    Second :after a1, 5d
                    Freeze :milestone, 2026-09-16, 0d
        """.trimIndent()
        val scene = scene(draw(source))
        val bars = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.tone != null }
        val diamonds = flatten(scene.marks).filterIsInstance<Mark.Poly>().filter { it.tone != null }

        assertEquals(2, bars.size)
        assertEquals(1, diamonds.size)
        val first = bars.first()
        val second = bars.last()
        assertEquals(first.rect.x + first.rect.w, second.rect.x, 0.5, "after a1 must start where a1 ends")
    }

    @Test
    fun `gantt rejects a task without a date`() {
        assertEquals(Fault.Syntax, err(draw("gantt\n section S\n Task :nonsense")).fault)
    }

    // --- git ---

    @Test
    fun `git graph places commits on branch lanes and links merges`() {
        val source = "gitGraph\n commit id: \"a\"\n branch f\n commit id: \"b\"\n checkout main\n merge f tag: \"v1\""
        val scene = scene(draw(source))
        val dots = flatten(scene.marks).filterIsInstance<Mark.Oval>()
        val texts = texts(scene)

        assertEquals(3, dots.size)
        assertTrue(texts.containsAll(listOf("main", "f", "a", "b", "v1")), "missing git labels in $texts")
    }

    @Test
    fun `git checkout of an unknown branch is a syntax error`() {
        assertEquals(Fault.Syntax, err(draw("gitGraph\n commit\n checkout nope")).fault)
    }

    // --- sankey ---

    @Test
    fun `sankey draws one band per flow`() {
        val scene = scene(draw("sankey-beta\nA,B,10\nB,C,5"))
        val bands = flatten(scene.marks).filterIsInstance<Mark.Poly>().filter { it.soft }
        val bars = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.tone != null }

        assertEquals(2, bands.size)
        assertEquals(3, bars.size)
    }

    @Test
    fun `sankey rejects malformed rows`() {
        assertEquals(Fault.Syntax, err(draw("sankey-beta\nA,B")).fault)
    }

    // --- architecture ---

    @Test
    fun `architecture honours edge side anchors`() {
        val source = "architecture-beta\n service a(server)[A]\n service b(database)[B]\n b:L -- R:a"
        val scene = scene(draw(source))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>().filter { it.fill == Role.Surface }

        assertEquals(2, boxes.size)
        val a = boxes.first()
        val b = boxes.last()
        assertTrue(a.rect.x < b.rect.x, "a should sit left of b (b:L -- R:a)")
    }

    // --- limits ---

    @Test
    fun `new engines enforce the node cap`() {
        val classes = (1..30).joinToString("\n") { "class C$it" }
        val out = runBlocking { engine.draw("classDiagram\n$classes", spec().copy(limits = Limits(nodes = 5))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    @Test
    fun `sankey refuses more unique nodes than the cap allows`() {
        val rows = (1..30).joinToString("\n") { "s$it,t$it,1" }
        val out = runBlocking { engine.draw("sankey-beta\n$rows", spec().copy(limits = Limits(nodes = 5))) }

        assertEquals(Fault.Limit, err(out).fault)
    }

    // --- malformed input that must not hang or crash ---

    /**
     * Row splitting is `Int` arithmetic with no suspend point, so an unbounded end bit would overflow
     * into an endless loop that the render timeout cannot interrupt.
     */
    @Test
    fun `packet refuses an out of range bit index instead of looping`() {
        assertEquals(Fault.Limit, err(draw("packet-beta\n 0-2147483647: \"x\"")).fault)
        assertEquals(Fault.Limit, err(draw("packet-beta\n 99999999999999: \"x\"")).fault)
    }

    /** Re-opening a composite inside itself used to make the scope walk spin forever. */
    @Test
    fun `state refuses a composite nested inside itself`() {
        val out = draw("stateDiagram-v2\n state A {\n state A {\n [*] --> B\n }\n }")

        assertEquals(Fault.Syntax, err(out).fault)
    }

    /** The same shape in C4 made a boundary a member of itself, recursing to a StackOverflowError. */
    @Test
    fun `c4 refuses a duplicate boundary id`() {
        val out = draw("C4Context\n Enterprise_Boundary(a, \"A\") {\n Enterprise_Boundary(a, \"A\") {\n System(s, \"S\")\n }\n }")

        assertEquals(Fault.Syntax, err(out).fault)
    }

    @Test
    fun `an empty composite state still renders a frame`() {
        val scene = scene(draw("stateDiagram-v2\n [*] --> A\n state A {\n }"))

        assertTrue(texts(scene).contains("A"), "expected the composite title")
    }

    @Test
    fun `radar handles values below the default minimum`() {
        val scene = scene(draw("radar-beta\n axis a, b\n curve c{-5, -10}"))

        assertTrue(flatten(scene.marks).filterIsInstance<Mark.Poly>().any { it.soft }, "expected a curve fill")
    }

    // --- layout order ---

    /** `Circle --|> Shape` points the triangle at Shape, so Shape is the parent and sits on top. */
    @Test
    fun `class parents sit above children regardless of declaration order`() {
        val scene = scene(draw("classDiagram\n Circle --|> Shape"))
        val boxes = flatten(scene.marks).filterIsInstance<Mark.Box>()
        val texts = flatten(scene.marks).filterIsInstance<Mark.Text>()
        val shape = texts.single { it.text == "Shape" }
        val circle = texts.single { it.text == "Circle" }

        assertEquals(2, boxes.size)
        assertTrue(shape.at.y < circle.at.y, "Shape should sit above Circle")
    }

    private fun draw(source: String) = runBlocking { engine.draw(source, spec()) }

    private fun texts(scene: ai.kilocode.client.ui.diagram.Scene) =
        flatten(scene.marks).filterIsInstance<Mark.Text>().map { it.text }
}
