package ai.kilocode.client.settings.agents

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.rpc.dto.McpConfigDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JLabel

class McpEditDialogTest : BasePlatformTestCase() {
    private var dialog: McpEditDialog? = null

    override fun tearDown() {
        try {
            dialog?.let { item -> edt { Disposer.dispose(item.disposable); true } }
            dialog = null
        } finally {
            super.tearDown()
        }
    }

    fun `test loads local server into form`() {
        val d = open(local())

        edt {
            val root = d.centerComponent()
            assertEquals("node", field<JBTextField>(root, title("command")).text)
            assertEquals("server.js\n--flag", field<JBTextArea>(root, title("args")).text)
            assertTrue(hasRow(root, "TOKEN=x"))
            assertTrue(hasRow(root, "EMPTY="))
            assertTrue(hasRow(root, title("command")))
            assertFalse(hasRow(root, title("url")))
            true
        }
    }

    fun `test loads remote server into form`() {
        val d = open(remote())

        edt {
            val root = d.centerComponent()
            assertEquals("https://mcp.example.test", field<JBTextField>(root, title("url")).text)
            assertTrue(hasRow(root, title("url")))
            assertFalse(hasRow(root, title("command")))
            assertFalse(hasRow(root, title("args")))
            true
        }
    }

    fun `test reads local edits back and preserves untouched fields`() {
        val d = open(local())

        val result = edt {
            val root = d.centerComponent()
            field<JBTextField>(root, title("command")).text = "bun"
            field<JBTextArea>(root, title("args")).text = "mcp.ts\n\n--watch"
            d.result()
        }

        assertEquals(listOf("bun", "mcp.ts", "--watch"), result.command)
        assertEquals(mapOf("TOKEN" to "x", "EMPTY" to ""), result.environment)
        assertEquals(mapOf("Authorization" to "Bearer test"), result.headers)
        assertEquals(false, result.enabled)
        assertEquals(12000L, result.timeout)
    }

    fun `test reads remote edits back and preserves untouched fields`() {
        val d = open(remote())

        val result = edt {
            val root = d.centerComponent()
            field<JBTextField>(root, title("url")).text = "https://new.example.test/mcp"
            d.result()
        }

        assertEquals("https://new.example.test/mcp", result.url)
        assertEquals(mapOf("X-Test" to "1"), result.headers)
        assertEquals(true, result.enabled)
        assertEquals(5000L, result.timeout)
    }

    fun `test environment can add and remove rows`() {
        val d = open(local())

        val result = edt {
            val root = d.centerComponent()
            val fields = descendants(root).filterIsInstance<JBTextField>()
            fields[1].text = "NEXT"
            fields[2].text = "value"
            descendants(root).filterIsInstance<JButton>().single { it.text == KiloBundle.message("settings.agentBehavior.mcp.edit.env.add") }.doClick()
            assertTrue(hasRow(root, "NEXT=value"))
            removeEnv(root, "TOKEN=x")
            assertFalse(hasRow(root, "TOKEN=x"))
            d.result()
        }

        assertEquals(mapOf("EMPTY" to "", "NEXT" to "value"), result.environment)
    }

    fun `test local result uses canonical local type`() {
        val d = open(local().copy(type = "stdio"))

        val result = edt { d.result() }

        assertEquals("local", result.type)
        assertEquals(mapOf("TOKEN" to "x", "EMPTY" to ""), result.environment)
    }

    private fun local() = McpConfigDto(
        type = "local",
        command = listOf("node", "server.js", "--flag"),
        environment = linkedMapOf("TOKEN" to "x", "EMPTY" to ""),
        headers = mapOf("Authorization" to "Bearer test"),
        enabled = false,
        timeout = 12000L,
    )

    private fun remote() = McpConfigDto(
        type = "remote",
        url = "https://mcp.example.test",
        headers = mapOf("X-Test" to "1"),
        enabled = true,
        timeout = 5000L,
    )

    private fun open(cfg: McpConfigDto): McpEditDialog {
        val item = edt { McpEditDialog("server", cfg) }
        dialog = item
        return item
    }

    private fun title(field: String) = KiloBundle.message("settings.agentBehavior.mcp.edit.$field")

    private inline fun <reified T : Component> field(root: Component, title: String): T =
        descendants(rowByTitle(root, title)).filterIsInstance<T>().first()

    private fun rowByTitle(root: Component, title: String): Container =
        descendants(root).filterIsInstance<Container>().first { item ->
            (item is SettingsRow || item is SettingsStackedRow) &&
                descendants(item).any { it is JLabel && it.text == title }
        }

    private fun hasRow(root: Component, title: String): Boolean =
        envLabels(root).contains(title) || descendants(root).filterIsInstance<Container>().any { item ->
            (item is SettingsRow || item is SettingsStackedRow) &&
                descendants(item).any { it is JLabel && it.text == title }
        }

    private fun envLabels(root: Component): List<String> {
        val list = descendants(root).filterIsInstance<JBList<*>>().singleOrNull() ?: return emptyList()
        return (0 until list.model.size).map { list.model.getElementAt(it).toString() }
    }

    private fun removeEnv(root: Component, label: String) {
        val list = descendants(root).filterIsInstance<JBList<*>>().single()
        list.size = Dimension(320, 120)
        list.doLayout()
        val idx = envLabels(root).indexOf(label)
        val bounds = list.getCellBounds(idx, idx)
        val point = Point(bounds.x + bounds.width - 4, bounds.y + bounds.height / 2)
        list.dispatchEvent(mouse(list, MouseEvent.MOUSE_PRESSED, point))
        list.dispatchEvent(mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(list: JBList<*>, id: Int, point: Point) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        1,
        false,
        MouseEvent.BUTTON1,
    )

    private fun descendants(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach(::visit)
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
