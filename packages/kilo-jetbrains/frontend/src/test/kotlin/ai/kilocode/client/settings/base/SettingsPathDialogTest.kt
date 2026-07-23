package ai.kilocode.client.settings.base

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextField

class SettingsPathDialogTest : BasePlatformTestCase() {
    fun `test browse input wraps the field and writes the chosen path`() {
        val field = JBTextField()
        val input = settingsPathInput(field) { "/chosen" }
        assertSame(field, input.childComponent)
        @Suppress("DEPRECATION")
        input.button.doClick()
        assertEquals("/chosen", field.text)
    }

    fun `test browse variant dialog focuses the field`() {
        val dialog = SettingsPathDialog("Add Instruction File", "", browse = { "/chosen" })
        try {
            assertTrue(dialog.preferredFocusedComponent is JBTextField)
        } finally {
            dialog.close(0)
        }
    }

    fun `test plain variant dialog focuses the field and exposes its value`() {
        val dialog = SettingsPathDialog("Add Skill URL", "https://x")
        try {
            assertTrue(dialog.preferredFocusedComponent is JBTextField)
            assertEquals("https://x", dialog.value())
        } finally {
            dialog.close(0)
        }
    }
}
