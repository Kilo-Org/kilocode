package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.rpc.dto.PermissionRuleItemDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.awt.Component
import java.awt.Container
import javax.swing.JLabel

class AgentEditDialogTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var app: KiloAppService
    private var dialog: AgentEditDialog? = null

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        app = KiloAppService(scope, FakeAppRpcApi())
    }

    override fun tearDown() {
        try {
            dialog?.let { d -> edt { Disposer.dispose(d.disposable); true } }
            dialog = null
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test loads agent into form`() {
        val agent = draft().copy(
            description = "Review desc",
            prompt = "Prompt text",
            model = "kilo/gpt-5",
            variant = "high",
            mode = KiloCliParser.MODE_ALL,
            hidden = true,
            disable = true,
            temperature = 0.4,
            topP = 0.8,
            steps = 12,
        )
        val d = open(agent)

        edt {
            val root = d.centerComponent()
            assertEquals("Review desc", field<JBTextArea>(root, title("description")).text)
            assertEquals("Prompt text", field<EditorTextField>(root, title("prompt")).text)
            assertEquals("0.4", field<JBTextField>(root, title("temperature")).text)
            assertEquals("0.8", field<JBTextField>(root, title("topP")).text)
            assertEquals("12", field<JBTextField>(root, title("steps")).text)
            assertEquals(KiloCliParser.MODE_ALL, field<ComboBox<*>>(root, title("mode")).selectedItem)
            assertTrue(field<SettingsToggle>(root, title("hidden")).isSelected)
            assertTrue(field<SettingsToggle>(root, title("disabled")).isSelected)
            val result = d.result()
            assertEquals("kilo/gpt-5", result.model)
            assertEquals("high", result.variant)
            true
        }
    }

    fun `test reads edits back into draft`() {
        val d = open(draft())

        val result = edt {
            val root = d.centerComponent()
            field<JBTextArea>(root, title("description")).text = "New desc"
            field<EditorTextField>(root, title("prompt")).text = "New prompt"
            field<JBTextField>(root, title("temperature")).text = "0.2"
            field<JBTextField>(root, title("topP")).text = "0.5"
            field<JBTextField>(root, title("steps")).text = "7"
            field<ComboBox<*>>(root, title("mode")).selectedItem = KiloCliParser.MODE_SUBAGENT
            field<SettingsToggle>(root, title("hidden")).doClick()
            field<SettingsToggle>(root, title("disabled")).doClick()
            d.result()
        }

        assertEquals("New desc", result.description)
        assertEquals("New prompt", result.prompt)
        assertEquals(0.2, result.temperature)
        assertEquals(0.5, result.topP)
        assertEquals(7L, result.steps)
        assertEquals(KiloCliParser.MODE_SUBAGENT, result.mode)
        assertTrue(result.hidden)
        assertTrue(result.disable)
    }

    fun `test native agent omits restricted editing`() {
        val agent = draft().copy(
            name = "ask",
            description = "Built in",
            prompt = "Built in prompt",
            native = true,
        )
        val d = open(agent)

        edt {
            val root = d.centerComponent()
            assertFalse(field<JBTextArea>(root, title("description")).isEditable)
            assertFalse(field<ComboBox<*>>(root, title("mode")).isEnabled)
            assertFalse(hasRow(root, title("hidden")))
            assertFalse(hasRow(root, title("disabled")))
            val result = d.result()
            assertEquals("Built in", result.description)
            assertEquals(KiloCliParser.MODE_PRIMARY, result.mode)
            assertFalse(result.hidden)
            assertFalse(result.disable)
            true
        }
    }

    fun `test custom agent shows export action`() {
        val d = open(draft())

        edt {
            val root = d.centerComponent()
            val button = descendants(rowByTitle(root, title("name"))).filterIsInstance<HoverIcon>().first()
            val text = KiloBundle.message("settings.agentBehavior.agents.edit.export")
            assertTrue(button.isEnabled)
            assertEquals(text, button.toolTipText)
            assertEquals(text, button.accessibleContext.accessibleName)
            true
        }
    }

    fun `test native agent hides export action`() {
        val d = open(draft().copy(native = true))

        edt {
            val root = d.centerComponent()
            assertTrue(descendants(rowByTitle(root, title("name"))).filterIsInstance<HoverIcon>().isEmpty())
            true
        }
    }

    fun `test builds deterministic agent export`() {
        val agent = draft().copy(
            description = "Description",
            prompt = "Prompt",
            model = "kilo/gpt-5",
            mode = KiloCliParser.MODE_SUBAGENT,
            temperature = 0.2,
            topP = 0.8,
            steps = 5,
            permission = listOf(
                PermissionRuleItemDto(tool = "bash", pattern = "uname", action = "allow"),
                PermissionRuleItemDto(tool = "edit", action = "ask"),
                PermissionRuleItemDto(tool = "bash", pattern = "*", action = "deny"),
            ),
        )

        assertEquals("""
            {
                "name": "code",
                "description": "Description",
                "prompt": "Prompt",
                "model": "kilo/gpt-5",
                "mode": "subagent",
                "temperature": 0.2,
                "top_p": 0.8,
                "steps": 5,
                "permission": {
                    "bash": {
                        "*": "deny",
                        "uname": "allow"
                    },
                    "edit": "ask"
                }
            }
        """.trimIndent(), buildAgentExport(agent))
    }

    fun `test export omits null optional fields`() {
        assertEquals("""
            {
                "name": "code",
                "mode": "primary"
            }
        """.trimIndent(), buildAgentExport(draft()))
    }

    private fun draft() = AgentEditDraft(name = "code", mode = KiloCliParser.MODE_PRIMARY, native = false)

    private fun open(agent: AgentEditDraft): AgentEditDialog {
        val d = edt { AgentEditDialog(agent, app, emptyList<ModelPicker.Item>()) }
        dialog = d
        return d
    }

    private fun title(field: String) = KiloBundle.message("settings.agentBehavior.agents.edit.$field")

    private inline fun <reified T : Component> field(root: Component, title: String): T =
        descendants(rowByTitle(root, title)).filterIsInstance<T>().first()

    private fun rowByTitle(root: Component, title: String): Container =
        descendants(root).filterIsInstance<Container>().first { item ->
            (item is SettingsRow || item is SettingsStackedRow) &&
                descendants(item).any { it is JLabel && it.text == title }
        }

    private fun hasRow(root: Component, title: String): Boolean =
        descendants(root).filterIsInstance<Container>().any { item ->
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
