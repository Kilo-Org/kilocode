package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Cancellation is driven from the measurement hook rather than a timeout so the test proves the
 * cooperative checks exist without depending on timing.
 */
class CancelTest {
    @Test
    fun `flowchart layout stops when the job is cancelled`() {
        val source = "flowchart TD\n" + (1..40).joinToString("\n") { "  n$it --> n${it + 1}" }

        assertFailsWith<CancellationException> { cancel(source) }
    }

    @Test
    fun `sequence layout stops when the job is cancelled`() {
        val source = "sequenceDiagram\n" + (1..40).joinToString("\n") { "  p$it->>p${it + 1}: step $it" }

        assertFailsWith<CancellationException> { cancel(source) }
    }

    @Test
    fun `uncancelled work completes`() {
        val out = runBlocking { Mermaid(FakeMeasure()).draw("flowchart TD\n A --> B", spec()) }

        assertTrue(scene(out).marks.isNotEmpty())
    }

    private fun cancel(source: String) = runBlocking {
        val job = Job()
        val scope = CoroutineScope(job + Dispatchers.Unconfined)
        val measure = FakeMeasure { calls -> if (calls >= CUT) job.cancel() }
        scope.async { Mermaid(measure).draw(source, spec()) }.await()
    }

    private companion object {
        const val CUT = 3
    }
}
