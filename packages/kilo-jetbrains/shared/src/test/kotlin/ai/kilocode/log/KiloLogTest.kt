package ai.kilocode.log

import java.util.logging.Formatter
import java.util.logging.Level
import java.util.logging.LogRecord
import kotlin.io.path.createTempDirectory
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

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

    @Test
    fun `fresh handler rolls a previous run aside so the file holds only this run`() {
        val dir = createTempDirectory("kilo-log")
        val log = dir.resolve("kilo.log")
        log.writeText("previous run\n")

        val handler = RotatingLogHandler(log, 10_000, 2, fresh = true)
        handler.formatter = LineFormatter()
        handler.publish(LogRecord(Level.INFO, "this run"))

        assertEquals("this run\n", log.readText())
        assertEquals("previous run\n", dir.resolve("kilo.log.0").readText())
    }

    @Test
    fun `fresh handler keeps an empty file in place`() {
        val dir = createTempDirectory("kilo-log")
        val log = dir.resolve("kilo.log")
        log.writeText("")

        val handler = RotatingLogHandler(log, 10_000, 2, fresh = true)
        handler.formatter = LineFormatter()
        handler.publish(LogRecord(Level.INFO, "first"))

        assertEquals("first\n", log.readText())
        assertFalse(dir.resolve("kilo.log.0").exists())
    }

    @Test
    fun `appending handler keeps the previous run in the same file`() {
        val dir = createTempDirectory("kilo-log")
        val log = dir.resolve("kilo.log")
        log.writeText("previous run\n")

        val handler = RotatingLogHandler(log, 10_000, 2)
        handler.formatter = LineFormatter()
        handler.publish(LogRecord(Level.INFO, "this run"))

        assertEquals("previous run\nthis run\n", log.readText())
        assertFalse(dir.resolve("kilo.log.0").exists())
    }

    @Test
    fun `file log startup deletes legacy dev logs`() {
        val dir = createTempDirectory("kilo-log")
        val current = dir.resolve("kilo.log")
        val rotated = dir.resolve("kilo.log.0")
        val legacy = dir.resolve("kilo-dev.log.0")
        val old = dir.resolve("kilo-dev.log.1")

        current.writeText("current")
        rotated.writeText("rotated")
        legacy.writeText("legacy")
        old.writeText("old")

        FileLog.deleteLegacyLogs(dir)

        assertTrue(current.exists())
        assertTrue(rotated.exists())
        assertFalse(legacy.exists())
        assertFalse(old.exists())
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
