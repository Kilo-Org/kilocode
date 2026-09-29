package ai.kilocode.client.settings.agents

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.util.edtWait
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBTextField
import java.awt.Component
import java.awt.Container

class McpAuthUrlDialogTest : BasePlatformTestCase() {
    private var dialog: McpAuthUrlDialog? = null

    override fun tearDown() {
        try {
            dialog?.let { item -> edt { Disposer.dispose(item.disposable); true } }
            dialog = null
        } finally {
            super.tearDown()
        }
    }

    fun `test url is rendered read only in the content panel`() {
        val d = open("linear", "https://auth.example.test/authorize?state=abc")

        edt {
            val field = descendants(d.contentForTest()).filterIsInstance<JBTextField>().single()
            assertEquals("https://auth.example.test/authorize?state=abc", field.text)
            assertFalse("the URL field must not be user-editable", field.isEditable)
            true
        }
    }

    fun `test message includes the server name`() {
        val d = open("linear", "https://auth.example.test/authorize")

        edt {
            val expected = KiloBundle.message("settings.agentBehavior.mcp.authUrl.message", "linear")
            assertTrue(text(d.contentForTest()).contains(expected))
            true
        }
    }

    fun `test title includes finish sign in wording`() {
        val d = open("linear", "https://auth.example.test/authorize")

        edt {
            assertEquals(KiloBundle.message("settings.agentBehavior.mcp.authUrl.title"), d.title)
            true
        }
    }

    private fun open(name: String, url: String): McpAuthUrlDialog {
        val item = edt { McpAuthUrlDialog(name, url) }
        dialog = item
        return item
    }

    private fun text(root: Component): String = descendants(root)
        .filterIsInstance<javax.swing.JLabel>()
        .joinToString(" ") { it.text.orEmpty() }

    private fun descendants(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach(::visit)
        }
        visit(root)
        return out
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
