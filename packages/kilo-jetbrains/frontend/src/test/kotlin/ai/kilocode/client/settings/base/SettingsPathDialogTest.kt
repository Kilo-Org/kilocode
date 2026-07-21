package ai.kilocode.client.settings.base

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextField
import java.awt.Container

class SettingsPathDialogTest : BasePlatformTestCase() {
    fun `test browse variant renders text field with chooser button and focuses field`() {
        run {
            val dialog = SettingsPathDialog("Add Instruction File", "", browse = { "/chosen" })
            try {
                assertTrue(descendants(dialog.component()).any { it.javaClass.simpleName == "TextFieldWithBrowseButton" })
                val focus = dialog.preferredFocusedComponent
                assertTrue(focus is JBTextField)
                assertTrue(descendants(dialog.component()).contains(focus))
            } finally {
                dialog.close(0)
            }
        }
    }

    fun `test plain variant renders bare text field`() {
        val dialog = SettingsPathDialog("Add Skill URL", "https://x")
        try {
            assertFalse(descendants(dialog.component()).any { it.javaClass.simpleName == "TextFieldWithBrowseButton" })
            assertTrue(dialog.preferredFocusedComponent is JBTextField)
            assertEquals("https://x", dialog.value())
        } finally {
            dialog.close(0)
        }
    }

    private fun descendants(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }
}
