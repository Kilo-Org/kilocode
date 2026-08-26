package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertNotNull

/**
 * Font-independent invariants, checked under both the deterministic fake and real AWT metrics.
 *
 * Snapshots pin exact geometry for one measurement model; these assertions catch layout bugs that a
 * different font would expose, which is the failure mode snapshots cannot see.
 */
class InvariantTest {
    @Test
    fun `fake metrics keep nodes separated and inside bounds`() {
        check(FakeMeasure())
    }

    @Test
    fun `real font metrics keep nodes separated and inside bounds`() {
        check(AwtMeasure())
    }

    private fun check(measure: Measure) {
        val engine = Mermaid(measure)
        val spec = spec(size = 12)
        for (name in ConformanceTest.CORPUS) {
            val out = runBlocking { engine.draw(read(name), spec) }
            val scene = scene(out)

            assertInBounds(scene, measure, spec)
            assertNoOverlap(scene)
            assertEdgesTouchNodes(scene)
        }
    }

    private fun read(name: String): String {
        val stream = javaClass.getResourceAsStream("/diagram/$name.mmd")
        assertNotNull(stream, "missing corpus file $name.mmd")
        return stream.bufferedReader().use { it.readText() }
    }
}
