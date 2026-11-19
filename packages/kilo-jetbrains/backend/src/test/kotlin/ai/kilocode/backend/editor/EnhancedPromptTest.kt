package ai.kilocode.backend.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class EnhancedPromptTest {
    @Test fun `strip a wrapping fence and matching quotes without altering inner instructions`() {
        val draft = "Explain \"why\".\nKeep the examples."
        assertEquals(draft, cleanEnhancedPrompt("  ```text\r\n'$draft'\r\n```  "))
        assertEquals(draft, cleanEnhancedPrompt(draft))
    }

    @Test fun `preserve mismatched quotes and treat provider whitespace as empty`() {
        assertEquals("\"unchanged'", cleanEnhancedPrompt("\"unchanged'"))
        assertEquals("", cleanEnhancedPrompt("\n\t"))
    }
}
