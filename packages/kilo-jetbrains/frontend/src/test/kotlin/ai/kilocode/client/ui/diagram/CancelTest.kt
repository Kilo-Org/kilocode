package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Flow
import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import ai.kilocode.client.ui.diagram.mermaid.Seq
import ai.kilocode.client.ui.diagram.mermaid.Source
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
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

    /** Parsing runs before any measurement, so its cancellation checks need their own proof. */
    @Test
    fun `parsing stops before layout when the job is cancelled`() {
        val flow = sink { Flow().parse(Source.clean("flowchart TD\n A --> B")) }
        val seq = sink { Seq().parse(Source.clean("sequenceDiagram\n A->>B: hi")) }

        assertTrue(flow.isEmpty(), "flowchart parsing ignored cancellation")
        assertTrue(seq.isEmpty(), "sequence parsing ignored cancellation")
    }

    /** Runs [body] in a coroutine that cancels itself first; a result only lands if that was ignored. */
    private fun sink(body: suspend () -> Any): List<Any> = runBlocking {
        val out = mutableListOf<Any>()
        val job = Job()
        CoroutineScope(job + Dispatchers.Unconfined).launch {
            job.cancel()
            out.add(body())
        }.join()
        out
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
