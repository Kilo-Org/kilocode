package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The contract any diagram engine must satisfy, not a test of one implementation. A replacement
 * engine should be pointed at this corpus first.
 */
class ConformanceTest {
    private val engine = Mermaid(FakeMeasure())

    @Test
    fun `every corpus diagram produces a finite scene`() {
        for (name in CORPUS.keys) {
            val out = runBlocking { engine.draw(read(name), spec()) }
            val scene = scene(out)

            assertTrue(scene.marks.isNotEmpty(), "$name produced no marks")
            assertTrue(scene.size.w > 0 && scene.size.h > 0, "$name has an empty size ${scene.size}")
            assertTrue(scene.size.w.isFinite() && scene.size.h.isFinite(), "$name has a non-finite size")
        }
    }

    @Test
    fun `corpus diagrams report the detected type`() {
        for ((name, expected) in CORPUS) {
            val out = runBlocking { engine.draw(read(name), spec()) }

            assertEquals(expected, scene(out).type, "$name resolved the wrong type")
        }
    }

    @Test
    fun `rendering is deterministic across runs`() {
        for (name in CORPUS.keys) {
            val first = runBlocking { engine.draw(read(name), spec()) }
            val second = runBlocking { Mermaid(FakeMeasure()).draw(read(name), spec()) }

            assertEquals(scene(first).toString(), scene(second).toString(), "$name is not deterministic")
        }
    }

    @Test
    fun `text marks never lose their content`() {
        for (name in CORPUS.keys) {
            val out = runBlocking { engine.draw(read(name), spec()) }
            val texts = flatten(scene(out).marks).filterIsInstance<Mark.Text>()

            assertTrue(texts.isNotEmpty(), "$name produced no labels")
            assertTrue(texts.none { it.text.isEmpty() }, "$name produced an empty label")
        }
    }

    private fun read(name: String): String {
        val stream = javaClass.getResourceAsStream("/diagram/$name.mmd")
        assertNotNull(stream, "missing corpus file $name.mmd")
        return stream.bufferedReader().use { it.readText() }
    }

    internal companion object {
        val CORPUS = mapOf(
            "flow-basic" to Type.Flowchart,
            "flow-shapes" to Type.Flowchart,
            "flow-subgraph" to Type.Flowchart,
            "flow-cycle" to Type.Flowchart,
            "flow-long" to Type.Flowchart,
            "seq-basic" to Type.Sequence,
            "seq-blocks" to Type.Sequence,
            "seq-notes" to Type.Sequence,
            "class-basic" to Type.Class,
            "state-basic" to Type.State,
            "er-basic" to Type.Er,
            "journey-basic" to Type.Journey,
            "gantt-basic" to Type.Gantt,
            "pie-basic" to Type.Pie,
            "quadrant-basic" to Type.Quadrant,
            "requirement-basic" to Type.Requirement,
            "git-basic" to Type.Git,
            "c4-basic" to Type.C4,
            "mindmap-basic" to Type.Mindmap,
            "timeline-basic" to Type.Timeline,
            "sankey-basic" to Type.Sankey,
            "xychart-basic" to Type.XyChart,
            "block-basic" to Type.Block,
            "packet-basic" to Type.Packet,
            "kanban-basic" to Type.Kanban,
            "architecture-basic" to Type.Architecture,
            "radar-basic" to Type.Radar,
            "treemap-basic" to Type.Treemap,
        )
    }
}
