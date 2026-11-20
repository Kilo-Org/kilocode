package ai.kilocode.client.ui.md

import ai.kilocode.client.ui.md.hybrid.MdTerminal
import ai.kilocode.client.ui.md.hybrid.Stream
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdTerminalTest : BasePlatformTestCase() {
    fun `test split preserves trailing empty segment`() {
        assertEquals(listOf("one", "two", ""), MdTerminal.split("one\ntwo\n", '\n'))
    }

    fun `test reduce collapses carriage frames and backspaces`() {
        assertEquals("done\nab", MdTerminal.reduce("step 1\rstep 2\rdone\nabc\b", keepSgr = false))
    }

    fun `test reduce keeps only sgr escapes when requested`() {
        val text = "\u001B[32mgreen\u001B[0m\u001B[K"

        assertEquals("\u001B[32mgreen\u001B[0m", MdTerminal.reduce(text, keepSgr = true))
        assertEquals("green", MdTerminal.reduce(text, keepSgr = false))
    }

    fun `test strip removes ansi escapes`() {
        assertEquals("green", MdTerminal.strip("\u001B[32mgreen\u001B[0m"))
        assertTrue(MdTerminal.hasAnsi("\u001B[32mgreen\u001B[0m"))
    }

    fun `test decode produces ranges for sgr coloring`() {
        val term = MdTerminal.decode("\u001B[32mgreen\u001B[0m\n", Stream.Stdout)

        assertEquals("green", term.text)
        assertTrue(term.ranges.any { term.text.substring(it.start, it.end) == "green" })
    }

    fun `test decode uses stdout and stderr keys`() {
        val out = MdTerminal.decode("ok", Stream.Stdout)
        val err = MdTerminal.decode("boom", Stream.Stderr)

        assertEquals(ProcessOutputTypes.STDOUT, out.ranges.single().key)
        assertEquals(ProcessOutputTypes.STDERR, err.ranges.single().key)
    }

    fun `test decode trims trailing newlines`() {
        val term = MdTerminal.decode("one\n\n", Stream.Stdout)

        assertEquals("one", term.text)
    }
}
