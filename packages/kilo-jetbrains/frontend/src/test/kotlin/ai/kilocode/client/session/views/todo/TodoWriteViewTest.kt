package ai.kilocode.client.session.views.todo

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PrimarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TodoViewDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.BorderLayout
import java.awt.Color
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class TodoWriteViewTest : BasePlatformTestCase() {

    fun `test canRender only completed todowrite`() {
        assertTrue(TodoWriteView.canRender(tool("todowrite", ToolExecState.COMPLETED)))
        assertFalse(TodoWriteView.canRender(tool("todowrite", ToolExecState.PENDING)))
        assertFalse(TodoWriteView.canRender(tool("todowrite", ToolExecState.RUNNING)))
        assertFalse(TodoWriteView.canRender(tool("bash", ToolExecState.COMPLETED)))
    }

    fun `test renders title subtitle and rows`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(
                TodoDto("Done", "completed", "high"),
                TodoDto("Next", "pending", "medium"),
            )
        })
        val base: Any = view

        assertTrue(view.labelText().contains("To-dos"))
        assertTrue(base is PrimarySessionPartView)
        assertTrue(view.labelText().contains("1/2"))
        assertTrue(view.isExpanded())
        assertEquals(2, view.rowCount())
        assertTrue(view.rowChecked(0))
        assertFalse(view.rowChecked(1))
        assertTrue(view.rowText(0).contains("<s>Done</s>"))
        assertEquals(SessionUiStyle.View.Todo.checkBg(), view.rowCheckBackground(0))
        assertEquals(SessionUiStyle.View.Todo.checkBg(), view.rowCheckBackground(1))
        assertEquals(SessionUiStyle.View.Todo.checkFg(), view.rowCheckForeground(0))
        assertEquals(SessionUiStyle.View.Todo.checkBorder(), view.rowCheckBorder(0))
        assertEquals("Completed to-do: Done", view.rowCheckAccessibleName(0))
        assertEquals("Pending to-do: Next", view.rowCheckAccessibleName(1))
    }

    fun `test pending rows keep normal foreground`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(
                TodoDto("Done", "completed", "high"),
                TodoDto("Next", "pending", "medium"),
            )
        })
        val style = SessionEditorStyle.current().copy(editorForeground = Color(1, 2, 3))

        view.applyStyle(style)

        assertEquals(style.editorForeground, view.rowForeground(1))
    }

    fun `test changed rows use same regular font as other rows`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(
                TodoDto("Changed", "pending", "high", changed = true),
                TodoDto("Regular", "pending", "medium"),
            )
        })
        val style = SessionEditorStyle.current()

        view.applyStyle(style)

        assertEquals(style.regularFont, view.rowFont(0))
        assertEquals(style.regularFont, view.rowFont(1))
    }

    fun `test todo header title subtitle gap uses standard medium gap`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Next", "pending", "medium"))
        })

        assertEquals(UiStyle.Gap.md(), centerGap(view))
    }

    fun `test todo body uses next standard inner padding`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Next", "pending", "medium"))
        })
        val body = view.components.filterIsInstance<TodoListPanel>().single()
        val ins = body.border.getBorderInsets(body)

        assertEquals(UiStyle.Gap.lg() + SessionUiStyle.View.Outline.width(), ins.top)
        assertEquals(UiStyle.Gap.pad(), ins.left)
        assertEquals(UiStyle.Gap.lg(), ins.bottom)
        assertEquals(UiStyle.Gap.pad(), ins.right)
    }

    fun `test compact view renders hidden labels and visible rows`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(
                TodoDto("Done", "completed", "high"),
                TodoDto("Next", "pending", "medium"),
                TodoDto("Later", "pending", "low"),
            )
            it.todoView = TodoViewDto(
                mode = "compact",
                todos = listOf(TodoDto("Changed", "pending", "high", changed = true)),
                hiddenBefore = 1,
                hiddenAfter = 1,
                changed = 1,
            )
        })

        assertTrue(view.labelText().contains("1/3"))
        assertEquals(1, view.rowCount())
        assertTrue(view.rowText(0).contains("Changed"))
        assertTrue(view.hiddenText().contains("earlier to-do hidden"))
        assertTrue(view.hiddenText().contains("later to-do hidden"))
    }

    fun `test update reuses root and updates rows`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Old", "pending", "medium"))
        })
        val comps = view.components.toList()

        view.update(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("New", "completed", "high"))
        })

        assertEquals(comps, view.components.toList())
        assertTrue(view.labelText().contains("1/1"))
        assertTrue(view.rowChecked(0))
        assertTrue(view.rowText(0).contains("New"))
    }

    private fun centerGap(view: TodoWriteView): Int {
        val row = view.components.filterIsInstance<JPanel>().first()
        val header = (row.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as JPanel
        val center = (header.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as JPanel
        return (center.layout as BorderLayout).hgap
    }

    private fun tool(name: String, state: ToolExecState) = Tool("p1", name, toolKind(name)).also { it.state = state }
}
