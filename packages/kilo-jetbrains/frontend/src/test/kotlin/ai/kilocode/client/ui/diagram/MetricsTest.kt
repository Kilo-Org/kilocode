package ai.kilocode.client.ui.diagram

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

/** One [AwtMeasure] is shared by every off-EDT draw, so its font cache must tolerate concurrency. */
class MetricsTest {
    @Test
    fun `a shared instance measures consistently from many coroutines`() {
        val measure = AwtMeasure()
        val fonts = (8..24).map { FontSpec("Dialog", it, bold = it % 2 == 0) }
        val want = fonts.associateWith { AwtMeasure().width(TEXT, it) }

        val got = runBlocking(Dispatchers.Default) {
            List(64) { async { fonts.map { it to measure.width(TEXT, it) } } }.awaitAll()
        }

        for (batch in got) {
            for ((font, width) in batch) assertEquals(want.getValue(font), width, "$font measured differently")
        }
    }

    private companion object {
        const val TEXT = "Ag quick brown fox"
    }
}
