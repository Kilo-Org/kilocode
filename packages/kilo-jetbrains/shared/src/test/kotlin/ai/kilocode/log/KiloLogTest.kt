package ai.kilocode.log

import java.util.logging.Formatter
import java.util.logging.Level
import java.util.logging.LogRecord
import kotlin.io.path.createTempDirectory
import kotlin.io.path.readText
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

    @Test
    fun `file handler rotates main log into numbered logs`() {
        val dir = createTempDirectory("kilo-log")
        val log = dir.resolve("kilo.log")
        val handler = RotatingLogHandler(log, 10, 2)
        handler.formatter = LineFormatter()

        handler.publish(LogRecord(Level.INFO, "one"))
        handler.publish(LogRecord(Level.INFO, "two"))
        handler.publish(LogRecord(Level.INFO, "three"))
        handler.publish(LogRecord(Level.INFO, "four"))

        assertEquals("four\n", log.readText())
        assertEquals("three\n", dir.resolve("kilo.log.0").readText())
        assertEquals("one\ntwo\n", dir.resolve("kilo.log.1").readText())
    }

    private class LineFormatter : Formatter() {
        override fun format(record: LogRecord): String = "${record.message}\n"
    }

    private class FakeLog : KiloLog {
        override val isDebugEnabled = false
        override fun debug(block: () -> String) {}
        override fun info(msg: String) {}
        override fun warn(msg: String, t: Throwable?) {}
        override fun error(msg: String, t: Throwable?) {}
    }
}
