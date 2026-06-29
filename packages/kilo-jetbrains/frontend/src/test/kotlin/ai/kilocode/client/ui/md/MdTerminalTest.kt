package ai.kilocode.client.ui.md

import ai.kilocode.client.ui.md.hybrid.MdTerminal
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
}
