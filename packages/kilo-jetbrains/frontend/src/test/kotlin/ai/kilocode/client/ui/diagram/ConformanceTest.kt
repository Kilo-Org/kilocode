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
        for (name in CORPUS) {
            val out = runBlocking { engine.draw(read(name), spec()) }
            val scene = scene(out)

            assertTrue(scene.marks.isNotEmpty(), "$name produced no marks")
            assertTrue(scene.size.w > 0 && scene.size.h > 0, "$name has an empty size ${scene.size}")
            assertTrue(scene.size.w.isFinite() && scene.size.h.isFinite(), "$name has a non-finite size")
        }
    }

    @Test
    fun `corpus diagrams report the detected type`() {
        for (name in CORPUS) {
            val out = runBlocking { engine.draw(read(name), spec()) }
            val expected = if (name.startsWith("flow")) Type.Flowchart else Type.Sequence

            assertEquals(expected, scene(out).type, "$name resolved the wrong type")
        }
    }

    @Test
    fun `rendering is deterministic across runs`() {
        for (name in CORPUS) {
            val first = runBlocking { engine.draw(read(name), spec()) }
            val second = runBlocking { Mermaid(FakeMeasure()).draw(read(name), spec()) }

            assertEquals(scene(first).toString(), scene(second).toString(), "$name is not deterministic")
        }
    }

    @Test
    fun `text marks never lose their content`() {
        for (name in CORPUS) {
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
        val CORPUS = listOf(
            "flow-basic",
            "flow-shapes",
            "flow-subgraph",
            "flow-cycle",
            "flow-long",
            "seq-basic",
            "seq-blocks",
            "seq-notes",
        )
    }
}
