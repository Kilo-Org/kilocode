package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import java.awt.Component
import java.awt.Container
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class ActiveListEditPopupTest : BasePlatformTestCase() {
    fun `test edit content disables unchanged and blank values`() {
        val content = activeListEditContent(
            ActiveListEditOptions(value = "Current"),
            hide = {},
            commit = {},
        )
        val field = component<JBTextField>(content)
        val button = component<JButton>(content)

        assertFalse(button.isEnabled)
        field.text = "   "
        assertFalse(button.isEnabled)
        field.text = "Current"
        assertFalse(button.isEnabled)
        field.text = "Next"
        assertTrue(button.isEnabled)
    }

    fun `test edit content shows rename help label by default`() {
        val content = activeListEditContent(
            ActiveListEditOptions(value = "Current"),
            hide = {},
            commit = {},
        )

        val labels = components(content).filterIsInstance<JBLabel>().map { it.text }

        assertTrue(labels.contains("Use a custom name that describes your task."))
    }

    fun `test edit content commits trimmed value and hides`() {
        val hides = mutableListOf<Unit>()
        val commits = mutableListOf<String>()
        val content = activeListEditContent(
            ActiveListEditOptions(value = "Current"),
            hide = { hides += Unit },
            commit = { commits += it },
        )
        val field = component<JBTextField>(content)
        val button = component<JButton>(content)

        field.text = "  Next  "
        button.doClick()

        assertEquals(1, hides.size)
        assertEquals(listOf("Next"), commits)
    }

    private inline fun <reified T : Component> component(root: Component): T {
        val found = components(root).filterIsInstance<T>().firstOrNull()
        assertNotNull(found)
        return found!!
    }

    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }
}
