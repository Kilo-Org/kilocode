package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.plugin.KiloBundle
import junit.framework.TestCase

class PromptPasteCollapseTest : TestCase() {

    fun `test lines counts newlines plus one`() {
        assertEquals(1, lines("hello"))
        assertEquals(2, lines("hello\nworld"))
        assertEquals(3, lines("a\nb\nc"))
        assertEquals(1, lines(""))
    }

    fun `test collapsible is false at fourteen lines`() {
        assertFalse(collapsible((1..14).joinToString("\n") { "$it" }))
    }

    fun `test collapsible is true at fifteen lines`() {
        assertTrue(collapsible((1..15).joinToString("\n") { "$it" }))
    }

    fun `test collapsible is false at exactly four thousand chars`() {
        assertFalse(collapsible("a".repeat(4000)))
    }

    fun `test collapsible is true at four thousand one chars`() {
        assertTrue(collapsible("a".repeat(4001)))
    }

    fun `test placeholder reports line count from bundle`() {
        val text = (1..15).joinToString("\n") { "$it" }
        assertEquals(KiloBundle.message("prompt.paste.collapsed", 15), placeholder(text))
    }
}
