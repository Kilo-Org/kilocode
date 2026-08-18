package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.rpc.dto.AgentCreateDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import java.awt.Component
import java.awt.Container
import javax.swing.JLabel

class AgentCreateDialogTest : BasePlatformTestCase() {
    private var dialog: AgentCreateDialog? = null

    override fun tearDown() {
        try {
            dialog?.let { d -> edt { Disposer.dispose(d.disposable); true } }
            dialog = null
        } finally {
            super.tearDown()
        }
    }

    fun `test default form is empty primary project`() {
        val d = open(emptyList())

        assertEquals(AgentCreateDto("", "", KiloCliParser.MODE_PRIMARY, null, "project"), edt { d.result() })
    }

    fun `test agent id field defaults to fifty columns`() {
        val d = open(emptyList())

        assertEquals(50, edt { field<JBTextField>(d.centerComponent(), title("name")).columns })
    }

    fun `test reads form values into dto`() {
        val d = open(emptyList())

        val result = edt {
            val root = d.centerComponent()
            field<JBTextField>(root, title("name")).text = "reviewer"
            field<EditorTextField>(root, title("prompt")).text = "Review carefully"
            field<JBTextArea>(root, title("description")).text = "Reviews code"
            field<ComboBox<*>>(root, title("mode")).selectedItem = KiloCliParser.MODE_SUBAGENT
            val scope = field<ComboBox<*>>(root, title("scope"))
            scope.selectedItem = scope.getItemAt(1)
            d.result()
        }

        assertEquals(AgentCreateDto("reviewer", "Review carefully", KiloCliParser.MODE_SUBAGENT, "Reviews code", "global"), result)
    }

    fun `test trims values and drops blank description`() {
        val d = open(emptyList())

        val result = edt {
            val root = d.centerComponent()
            field<JBTextField>(root, title("name")).text = "  spacer  "
            field<EditorTextField>(root, title("prompt")).text = "  Prompt  "
            field<JBTextArea>(root, title("description")).text = "   "
            d.result()
        }

        assertEquals("spacer", result.name)
        assertEquals("Prompt", result.prompt)
        assertNull(result.description)
        assertEquals("project", result.scope)
    }

    private fun open(names: Collection<String>): AgentCreateDialog {
        val d = edt { AgentCreateDialog(names) }
        dialog = d
        return d
    }

    private fun title(field: String) = KiloBundle.message("settings.agentBehavior.agents.create.$field")

    private inline fun <reified T : Component> field(root: Component, title: String): T =
        descendants(rowByTitle(root, title)).filterIsInstance<T>().first()

    private fun rowByTitle(root: Component, title: String): Container =
        descendants(root).filterIsInstance<Container>().first { item ->
            (item is SettingsRow || item is SettingsStackedRow) &&
                descendants(item).any { it is JLabel && it.text == title }
        }

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
