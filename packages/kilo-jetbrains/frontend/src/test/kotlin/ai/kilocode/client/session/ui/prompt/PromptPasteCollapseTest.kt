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

    fun `test collapsible is false at four lines`() {
        assertFalse(collapsible("1\n2\n3\n4"))
    }

    fun `test collapsible is true at five lines`() {
        assertTrue(collapsible("1\n2\n3\n4\n5"))
    }

    fun `test collapsible is false at exactly eight hundred chars`() {
        assertFalse(collapsible("a".repeat(800)))
    }

    fun `test collapsible is true at eight hundred one chars`() {
        assertTrue(collapsible("a".repeat(801)))
    }

    fun `test placeholder reports line count from bundle`() {
        assertEquals(KiloBundle.message("prompt.paste.collapsed", 5), placeholder("1\n2\n3\n4\n5"))
    }
}
