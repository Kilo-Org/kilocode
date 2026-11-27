package ai.kilocode.client.ui.list

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBCheckBox
import java.awt.Component
import java.awt.Container
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class ActiveListDeletePopupTest : BasePlatformTestCase() {
    fun `test delete content confirms without gate`() {
        val hides = mutableListOf<Unit>()
        val confirms = mutableListOf<Boolean>()
        val content = activeListDeleteContent(
            ActiveListDeleteOptions(message = "Delete item?"),
            hide = { hides += Unit },
            confirm = { confirms += it },
        )

        val button = component<JButton>(content)

        assertTrue(button.isEnabled)
        button.doClick()
        assertEquals(1, hides.size)
        assertEquals(listOf(false), confirms)
    }

    fun `test delete content requires gate confirmation`() {
        val hides = mutableListOf<Unit>()
        val confirms = mutableListOf<Boolean>()
        val content = activeListDeleteContent(
            ActiveListDeleteOptions(message = "Delete item?", gate = "Confirm delete"),
            hide = { hides += Unit },
            confirm = { confirms += it },
        )
        val box = component<JBCheckBox>(content)
        val button = component<JButton>(content)

        assertFalse(button.isEnabled)
        box.doClick()
        assertTrue(button.isEnabled)
        button.doClick()

        assertEquals(1, hides.size)
        assertEquals(listOf(true), confirms)
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
