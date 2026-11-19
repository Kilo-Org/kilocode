package ai.kilocode.client.autocomplete

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KiloInlineCompletionTest {
    @Test fun `context preserves whitespace and takes the closest text on either side`() {
        val before = "x".repeat(9000) + "\n    "
        val after = "\n}\n" + "y".repeat(6000)
        assertEquals(before.takeLast(8192) to after.take(4096), fimContext(before + after, before.length))
        assertEquals("" to "after", fimContext("after", 0))
        assertEquals("before" to "", fimContext("before", 6))
        assertNull(fimContext(" \n ", 1))
        assertNull(fimContext("edited", 8))
    }
}
