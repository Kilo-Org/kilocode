package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.util.ui.UIUtil
import java.awt.Container
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent

class SettingsInlineListTest : BasePlatformTestCase() {
    fun `test empty list keeps minimum height for empty text`() {
        edt {
            val list = list()
            list.syncItems(emptyList(), true)
            layout(list)

            assertTrue(jbList(list).minimumSize.height >= UiStyle.Gap.xl())
        }
    }

    fun `test filtering to no rows keeps minimum empty list area`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny", "*.pem" to "deny"), true)
            layout(list)

            search(list).text = "nomatch"
            layout(list)

            assertEquals(0, jbList(list).model.size)
            assertTrue(jbList(list).minimumSize.height >= UiStyle.Gap.xl())
        }
    }

    fun `test toolbar delete removes selected rows in bulk`() {
        edt {
            val removed = mutableListOf<String>()
            val list = SettingsInlineList("Add", "e.g. *.env", {}, { _, _ -> }, { removed += it })
            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny"), true)
            layout(list)

            val jList = jbList(list)
            jList.setSelectionInterval(0, 1)
            UIUtil.dispatchAllInvocationEvents()
            click(button(list, 1))

            assertEquals(listOf("*.env", "*.key"), removed)
        }
    }

    fun `test toolbar add invokes onAdd with the input override value`() {
        edt {
            val added = mutableListOf<String>()
            val list = SettingsInlineList("Add", "e.g. *.env", { added += it }, { _, _ -> }, {})
            list.input = { "git *" }
            layout(list)

            click(button(list, 0))

            assertEquals(listOf("git *"), added)
        }
    }

    fun `test syncItems retains the same list view instance across updates`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny"), true)
            val jList = jbList(list)

            list.syncItems(listOf("*.env" to "deny", "*.key" to "deny"), true)

            assertSame(jList, jbList(list))
        }
    }

    fun `test setEnabled disables search add and list`() {
        edt {
            val list = list()
            list.syncItems(listOf("*.env" to "deny"), true)

            list.setEnabled(false)

            assertFalse(button(list, 0).isEnabled)
            assertFalse(jbList(list).isEnabled)
        }
    }

    private fun list(): SettingsInlineList = SettingsInlineList("Add", "e.g. *.env", {}, { _, _ -> }, {})

    private fun jbList(list: SettingsInlineList): JBList<*> = components(list).filterIsInstance<JBList<*>>().single()

    private fun search(list: SettingsInlineList): javax.swing.text.JTextComponent =
        components(list).filterIsInstance<javax.swing.text.JTextComponent>().first()

    private fun layout(root: Container) {
        root.setSize(400, root.preferredSize.height.coerceAtLeast(50))
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun button(list: SettingsInlineList, index: Int): JComponent = components(list)
        .filterIsInstance<JComponent>()
        .filter { it.javaClass.name.endsWith("ActionButton") }
        .let { it[index] }

    private fun click(target: JComponent) {
        target.setSize(target.preferredSize)
        val point = Point(target.width.coerceAtLeast(2) / 2, target.height.coerceAtLeast(2) / 2)
        val press = MouseEvent(
            target,
            MouseEvent.MOUSE_PRESSED,
            System.currentTimeMillis(),
            InputEvent.BUTTON1_DOWN_MASK,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val release = MouseEvent(
            target,
            MouseEvent.MOUSE_RELEASED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        val clicked = MouseEvent(
            target,
            MouseEvent.MOUSE_CLICKED,
            System.currentTimeMillis(),
            0,
            point.x,
            point.y,
            1,
            false,
            MouseEvent.BUTTON1,
        )
        target.dispatchEvent(press)
        target.dispatchEvent(release)
        target.dispatchEvent(clicked)
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
