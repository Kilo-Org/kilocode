package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.BorderLayout
import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.border.Border

/**
 * Tests for [ToolView].
 */
@Suppress("UnstableApiUsage")
class ToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<ToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

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
        val t = Tool("p1", "bash", toolKind("bash")).also { it.state = ToolExecState.RUNNING; it.title = "Install deps" }
        val view = track(ToolView(t))
        assertTrue(view.labelText().contains("Install deps"))
        assertTrue(view.labelText().contains("Shell"))
    }

    fun `test blank title falls back to tool name`() {
        val t = Tool("p1", "bash", toolKind("bash")).also { it.state = ToolExecState.COMPLETED; it.title = "   " }
        val view = track(ToolView(t))
        assertTrue(view.labelText().contains("Shell"))
    }

    fun `test bash tool shows subtitle command and output`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "git remote -v", "description" to "View remotes")
            it.output = "origin git@example.com:repo.git"
        }

        val view = track(ToolView(t))

        assertTrue(view.labelText().contains("Shell"))
        assertTrue(view.labelText().contains("View remotes"))
        assertEquals("git remote -v", view.commandText())
        assertEquals("origin git@example.com:repo.git", view.outputText())
        assertEquals("$ git remote -v\n\norigin git@example.com:repo.git", view.bodyText())
        assertFalse(view.isExpanded())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        assertFalse(view.bodyCreated())
        view.toggle()
        assertTrue(view.bodyVisible())
        assertTrue(view.bodyCreated())
    }

    fun `test bash tool uses secondary chrome`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))
        val base: Any = view

        assertTrue(base is SecondarySessionPartView)
    }

    fun `test unknown tool uses secondary chrome`() {
        val view = ToolView(tool("p1", "mystery", ToolExecState.COMPLETED))
        val base: Any = view

        assertTrue(base is SecondarySessionPartView)
    }

    fun `test tool outline is drawn only while expanded`() {
        val view = track(ToolView(tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

        assertEquals(0, paint(view.border).alpha)
        view.toggle()
        assertEquals(SessionUiStyle.View.Outline.color().rgb, paint(view.border).rgb)
        view.toggle()
        assertEquals(0, paint(view.border).alpha)
    }

    fun `test bash toggle collapses and expands`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "git log")
            it.output = "one\ntwo\nthree\nfour"
        }
        val view = track(ToolView(t))

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
        val view = track(ToolView(t))

        assertEquals("$ git log\n\none\ntwo\nthree\nfour", view.bodyText())
        assertTrue(view.hasToggle())
        assertFalse(view.bodyVisible())
        view.toggle()
        assertTrue(view.bodyVisible())
    }

    fun `test tool creates lazy body once after collapse and expand`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }
        val view = track(ToolView(t))

        assertFalse(view.bodyCreated())
        view.toggle()
        val body = view.bodyEditor()
        assertNotNull(body)
        view.toggle()
        view.toggle()

        assertSame(body, view.bodyEditor())
        assertTrue(view.bodyVisible())
    }

    fun `test collapsed update keeps lazy tool body uncreated`() {
        val view = track(ToolView(tool("p1", "bash", ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

        view.update(tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/home"
        })

        assertFalse(view.bodyCreated())
        assertEquals("$ pwd\n\n/home", view.bodyText())
    }

    fun `test collapsed update after first expand reuses tool body text`() {
        val view = track(ToolView(tool("p1", "bash", ToolExecState.RUNNING).also {
            it.input = mapOf("command" to "pwd")
            it.output = "/tmp"
        }))

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
        val view = track(ToolView(t))

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
        val view = track(ToolView(t))

        assertTrue(view.labelText().contains("Glob"))
        assertTrue(view.labelText().contains("/tmp"))
        assertEquals("/tmp/A.kt", view.bodyText())
        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        view.toggle()
        assertTrue(view.bodyVisible())
    }

    fun `test bash output uses editor font settings`() {
        val style = SessionEditorStyle.current()
        val view = track(ToolView(tool("p1", "bash", ToolExecState.COMPLETED).also { it.output = "done" }))
        view.toggle()

        assertCodeFont(view.bodyFont(), style)
        assertFalse(view.bodyEditable())
        assertFalse(view.bodyCaretVisible())
        assertFalse(view.bodyWrap())
        assertNotNull(view.bodyEditor())
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, view.horizontalPolicy())
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, view.verticalPolicy())
    }

    fun `test tool header uses editor-derived fonts`() {
        val style = SessionEditorStyle.current()
        val view = track(ToolView(tool("p1", "bash", ToolExecState.COMPLETED).also { it.output = "done" }))

        assertEditorFont(view.titleFont(), style)
        assertTrue(view.titleFont().isBold)
        assertSmallEditorFont(view.subtitleFont(), style)
        assertSmallEditorFont(view.stateFont(), style)
    }

    fun `test tool header title subtitle gap uses standard medium gap`() {
        val view = track(ToolView(tool("p1", "bash", ToolExecState.COMPLETED).also { it.output = "done" }))

        assertEquals(UiStyle.Gap.md(), centerGap(view))
    }

    fun `test applyStyle updates tool fonts in place`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))
        val style = SessionEditorStyle.create(family = "Courier New", size = 25)
        view.toggle()
        val editor = view.bodyEditor()

        view.applyStyle(style)

        assertSame(editor, view.bodyEditor())
        assertCodeFont(view.bodyFont(), style)
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

        val view = track(ToolView(t))

        assertEquals(1, view.controlCount())
    }

    fun `test expanded body is capped to fifteen rows`() {
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "log")
            it.output = (1..40).joinToString("\n") { line -> "line $line" }
        }
        val view = track(ToolView(t))

        view.toggle()

        assertEquals(15, view.bodyMaxRows())
        assertTrue(view.preferredSize.height > 0)
    }

    fun `test large tool output is truncated in preview`() {
        val out = "x".repeat(SessionUiStyle.View.Tool.PREVIEW_LIMIT + 1_000)
        val t = tool("p1", "bash", ToolExecState.COMPLETED).also {
            it.input = mapOf("command" to "log")
            it.output = out
        }

        val view = track(ToolView(t))
        view.toggle()

        assertEquals("$ log\n\n$out", view.bodyText())
        assertTrue(view.previewText().length < view.bodyText().length)
        assertTrue(view.previewText().contains("Output truncated in preview"))
    }

    fun `test large generic tool output is truncated in preview`() {
        val out = "x".repeat(SessionUiStyle.View.Tool.PREVIEW_LIMIT + 1_000)
        val t = tool("p1", "glob", ToolExecState.COMPLETED).also {
            it.output = out
        }

        val view = track(ToolView(t))
        view.toggle()

        assertEquals(out, view.bodyText())
        assertTrue(view.previewText().length < view.bodyText().length)
        assertTrue(view.previewText().contains("Output truncated in preview"))
    }

    // ---- update ------

    fun `test update changes state icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        val updated = Tool("p1", "bash", toolKind("bash")).also { it.state = ToolExecState.COMPLETED }
        view.update(updated)
        assertFalse(view.labelText().contains("Running"))
    }

    fun `test update changes title`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING, title = "old"))
        val updated = Tool("p1", "bash", toolKind("bash")).also { it.state = ToolExecState.COMPLETED; it.title = "new title" }
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
        val view = ToolView(Tool("part99", "edit", toolKind("edit")).also { it.state = ToolExecState.PENDING })
        assertEquals("part99", view.contentId)
    }

    // ---- helpers ------

    private fun tool(id: String, name: String, state: ToolExecState, title: String? = null): Tool =
        Tool(id, name, toolKind(name)).also { it.state = state; it.title = title }

    private fun track(view: ToolView): ToolView {
        views.add(view)
        return view
    }

    private fun assertEditorFont(font: java.awt.Font, style: SessionEditorStyle) {
        assertEquals(style.transcriptFont.name, font.name)
        assertEquals(style.editorSize, font.size)
    }

    private fun assertCodeFont(font: java.awt.Font, style: SessionEditorStyle) {
        assertEquals(style.editorFont.name, font.name)
        assertEquals(style.editorSize, font.size)
    }

    private fun assertSmallEditorFont(font: java.awt.Font, style: SessionEditorStyle) {
        assertEquals(style.smallEditorFont.name, font.name)
        assertTrue(font.size < style.editorSize)
    }

    private fun centerGap(view: ToolView): Int {
        val row = view.components.filterIsInstance<JPanel>().single()
        val header = (row.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as JPanel
        val center = (header.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as JPanel
        return (center.layout as BorderLayout).hgap
    }

    private fun paint(border: Border): Color {
        val image = BufferedImage(3, 3, BufferedImage.TYPE_INT_ARGB)
        val item = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(item, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        return Color(image.getRGB(0, 0), true)
    }
}
