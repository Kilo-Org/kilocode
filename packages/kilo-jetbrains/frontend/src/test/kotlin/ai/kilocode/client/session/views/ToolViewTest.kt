package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.ScrollPaneConstants

/**
 * Tests for [ToolView].
 */
@Suppress("UnstableApiUsage")
class ToolViewTest : BasePlatformTestCase() {

    // ---- state icons ------

    fun `test PENDING state shows pending label`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.PENDING))
        assertTrue(view.labelText().contains("Pending"))
    }

    fun `test RUNNING state shows running label`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        assertTrue(view.labelText().contains("Running"))
    }

    fun `test COMPLETED state hides state label`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))
        assertFalse(view.labelText().contains("Completed"))
    }

    fun `test ERROR state shows error label`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.ERROR))
        assertTrue(view.labelText().contains("Error"))
    }

    // ---- display text ------

    fun `test tool name shown when no title`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        assertTrue(view.labelText().contains("Shell"))
    }

    fun `test title shown instead of name when title is set`() {
        val t = Tool("p1", "bash").also { it.state = ToolExecState.RUNNING; it.title = "Install deps" }
        val view = ToolView(t)
        assertTrue(view.labelText().contains("Install deps"))
        assertTrue(view.labelText().contains("Shell"))
    }

    fun `test blank title falls back to tool name`() {
        val t = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED; it.title = "   " }
        val view = ToolView(t)
        assertTrue(view.labelText().contains("Shell"))
    }

    fun `test read tool shows filename`() {
        val t = tool("p1", "read", ToolExecState.COMPLETED).also { it.input = mapOf("filePath" to "README.MD") }

        val view = ToolView(t)

        assertTrue(view.labelText().contains("Read"))
        assertTrue(view.labelText().contains("README.MD"))
    }

    fun `test bash tool shows subtitle command and output`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "git remote -v", "description" to "View remotes")
            it.output = "origin git@example.com:repo.git"
        }

        val view = ToolView(t)

        assertTrue(view.labelText().contains("Shell"))
        assertTrue(view.labelText().contains("View remotes"))
        assertEquals("git remote -v", view.commandText())
        assertEquals("origin git@example.com:repo.git", view.outputText())
        assertEquals("$ git remote -v\n\norigin git@example.com:repo.git", view.bodyText())
        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertTrue(view.bodyCreated())
        view.toggle()
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test bash toggle collapses and expands`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "git log")
            it.output = "one\ntwo\nthree\nfour"
        }
        val view = ToolView(t)

        assertFalse(view.isExpanded())
        view.toggle()
        assertTrue(view.isExpanded())
        view.toggle()
        assertFalse(view.isExpanded())
    }

    fun `test collapsed bash hides body`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "git log")
            it.output = "one\ntwo\nthree\nfour"
        }
        val view = ToolView(t)

        assertEquals("$ git log\n\none\ntwo\nthree\nfour", view.bodyText())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        view.toggle()
        assertTrue(view.bodyVisible())
    }

    fun `test tool reuses eager body after collapse and expand`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }
        val view = ToolView(t)

        assertTrue(view.bodyCreated())
        view.toggle()
        val font = view.bodyFont()
        view.toggle()
        view.toggle()

        assertSame(font, view.bodyFont())
        assertTrue(view.bodyVisible())
    }

    fun `test collapsed update keeps eager tool body detached`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        })

        view.update(tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/home"
        })

        assertTrue(view.bodyCreated())
        assertEquals("$ pwd\n\n/home", view.bodyText())
    }

    fun `test collapsed update after first expand reuses tool body text`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        })

        view.toggle()
        view.toggle()
        view.update(tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/home"
        })

        assertTrue(view.bodyCreated())
        assertFalse(view.bodyVisible())
        assertEquals("$ pwd\n\n/home", view.bodyText())
    }

    fun `test short bash is still collapsible`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }
        val view = ToolView(t)

        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        assertEquals("$ pwd\n\n/tmp", view.bodyText())
        view.toggle()
        assertTrue(view.isExpanded())
    }

    fun `test generic tool with output is collapsible`() {
        val t = tool("p1", "glob", ToolExecState.COMPLETED).also {
            it.input = mapOf("path" to "/tmp", "pattern" to "**/*.kt")
            it.output = "/tmp/A.kt"
        }
        val view = ToolView(t)

        assertTrue(view.labelText().contains("Glob"))
        assertTrue(view.labelText().contains("/tmp"))
        assertEquals("/tmp/A.kt", view.bodyText())
        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        view.toggle()
        assertTrue(view.bodyVisible())
    }

    fun `test read tool handles windows path`() {
        val t = tool("p1", "read", ToolExecState.COMPLETED).also {
            it.input = mapOf("filePath" to "C:\\repo\\README.MD")
        }

        val view = ToolView(t)

        assertTrue(view.labelText().contains("README.MD"))
    }

    fun `test bash output uses editor font settings`() {
        val style = SessionStyle.current()
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))

        assertEditorFont(view.bodyFont(), style)
        assertFalse(view.bodyEditable())
        assertFalse(view.bodyCaretVisible())
        assertTrue(view.bodyWrap())
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, view.horizontalPolicy())
    }

    fun `test tool header uses editor-derived fonts`() {
        val style = SessionStyle.current()
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))

        assertEditorFont(view.titleFont(), style)
        assertTrue(view.titleFont().isBold)
        assertSmallEditorFont(view.subtitleFont(), style)
        assertSmallEditorFont(view.stateFont(), style)
    }

    fun `test applyStyle updates tool fonts in place`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))
        val style = SessionStyle.create(family = "Courier New", size = 25)

        view.applyStyle(style)

        assertEditorFont(view.bodyFont(), style)
        assertEditorFont(view.titleFont(), style)
        assertTrue(view.titleFont().isBold)
        assertSmallEditorFont(view.subtitleFont(), style)
        assertSmallEditorFont(view.stateFont(), style)
    }

    fun `test tool controls only include expand arrow`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }

        val view = ToolView(t)

        assertEquals(1, view.controlCount())
    }

    fun `test expanded body is capped to fifteen rows`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "log")
            it.output = (1..40).joinToString("\n") { line -> "line $line" }
        }
        val view = ToolView(t)

        view.toggle()

        assertEquals(15, view.bodyMaxRows())
        assertTrue(view.preferredSize.height > 0)
    }

    fun `test large tool output is truncated in preview`() {
        val out = "x".repeat(UiStyle.Size.toolBodyLimit() + 1_000)
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "log")
            it.output = out
        }

        val view = ToolView(t)
        view.toggle()

        assertEquals("$ log\n\n$out", view.bodyText())
        assertTrue(view.previewText().length < view.bodyText().length)
        assertTrue(view.previewText().contains("Output truncated in preview"))
    }

    fun `test large generic tool output is truncated in preview`() {
        val out = "x".repeat(UiStyle.Size.toolBodyLimit() + 1_000)
        val t = tool("p1", "glob", ToolExecState.COMPLETED).also {
            it.output = out
        }

        val view = ToolView(t)
        view.toggle()

        assertEquals(out, view.bodyText())
        assertTrue(view.previewText().length < view.bodyText().length)
        assertTrue(view.previewText().contains("Output truncated in preview"))
    }

    // ---- update ------

    fun `test update changes state icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        val updated = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED }
        view.update(updated)
        assertFalse(view.labelText().contains("Running"))
    }

    fun `test update changes title`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING, title = "old"))
        val updated = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED; it.title = "new title" }
        view.update(updated)
        assertTrue(view.labelText().contains("new title"))
    }

    fun `test update with non-Tool content is ignored`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        val before = view.labelText()
        view.update(ai.kilocode.client.session.model.Text("p1"))
        assertEquals(before, view.labelText())
    }

    // ---- contentId ------

    fun `test contentId matches Tool id`() {
        val view = ToolView(Tool("part99", "edit").also { it.state = ToolExecState.PENDING })
        assertEquals("part99", view.contentId)
    }

    // ---- helpers ------

    private fun tool(id: String, name: String, state: ToolExecState, title: String? = null): Tool =
        Tool(id, name).also { it.state = state; it.title = title }

    private fun assertEditorFont(font: java.awt.Font, style: SessionStyle) {
        assertEquals(style.editorFamily, font.name)
        assertEquals(style.editorSize, font.size)
    }

    private fun assertSmallEditorFont(font: java.awt.Font, style: SessionStyle) {
        assertEquals(style.editorFamily, font.name)
        assertTrue(font.size < style.editorSize)
    }
}
