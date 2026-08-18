package ai.kilocode.log

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class KiloLogTest {

    @Test
    fun `sandbox uses file log only`() {
        val file = FakeLog()
        val log = KiloLog.logger(
            sandbox = true,
            intellij = { error("IntelliJ log should not be created in sandbox") },
            file = { file },
        )

        assertSame(file, log)
    }

    @Test
    fun `release uses intellij and file logs`() {
        val intellij = FakeLog()
        val file = FakeLog()
        val log = KiloLog.logger(
            sandbox = false,
            intellij = { intellij },
            file = { file },
        )

        val composite = log as CompositeLog
        assertEquals(listOf(intellij, file), composite.delegates.toList())
    }

    private class FakeLog : KiloLog {
        override val isDebugEnabled = false
        override fun debug(block: () -> String) {}
        override fun info(msg: String) {}
        override fun warn(msg: String, t: Throwable?) {}
        override fun error(msg: String, t: Throwable?) {}
    }
}
