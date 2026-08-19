package ai.kilocode.client.session.views.todo

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TodoViewDto
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.JComponent
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

        assertTrue(view.labelText().contains("To-dos"))
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

    fun `test todo content is a rounded editor-background surface`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("A", "pending", "medium"))
        })
        val list = view.components.filterIsInstance<TodoListPanel>().single()

        // The todo list is the raised editor surface, but rounded like the header: non-opaque so the
        // corners reveal the transparent card body, filled with the editor background in the middle.
        assertFalse(list.isOpaque)

        list.setSize(80, 80)
        val image = BufferedImage(80, 80, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        list.paint(graphics)
        graphics.dispose()
        assertEquals("rounded corner reveals the backdrop", 0, image.getRGB(0, 0) ushr 24)
        assertEquals(SessionUiStyle.Colors.codeBlockBackground().rgb, image.getRGB(40, 4))
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

    fun `test todo header uses standard layout gap`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Next", "pending", "medium"))
        })

        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.GAP), headerGap(view))
    }

    fun `test todo body uses next standard inner padding`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Next", "pending", "medium"))
        })
        val body = view.components.filterIsInstance<TodoListPanel>().single()
        val ins = body.border.getBorderInsets(body)

        // No separator line: just the standard content padding, so the list reads as transparent
        // content set apart from the header by the base card's transparent gap.
        assertEquals(UiStyle.Gap.lg(), ins.top)
        assertEquals(UiStyle.Gap.pad(), ins.left)
        assertEquals(UiStyle.Gap.lg(), ins.bottom)
        assertEquals(UiStyle.Gap.pad(), ins.right)
    }

    fun `test todo rows use session view gap`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(
                TodoDto("First", "pending", "medium"),
                TodoDto("Second", "pending", "medium"),
            )
        })
        val body = view.components.filterIsInstance<TodoListPanel>().single()

        body.setSize(300, body.preferredSize.height)
        body.doLayout()

        val rows = body.components.filterIsInstance<Stack>().filter { it.isVisible }
        val gap = rows[1].y - (rows[0].y + rows[0].height)
        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.GAP), gap)
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

    private fun headerGap(view: TodoWriteView): Int {
        val row = view.components.filterIsInstance<JPanel>().first()
        val header = (row.layout as BorderLayout).getLayoutComponent(BorderLayout.CENTER) as JPanel
        return (header.layout as BorderLayout).hgap
    }

    fun `test todo header popup shows when collapsed and lists todos`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Done", "completed", "high"), TodoDto("Next", "pending", "medium"))
        })
        assertTrue(view.isExpanded())
        assertNull(view.headerPopup())

        view.toggle()
        assertFalse(view.isExpanded())
        val body = view.headerPopup()!!.build()
        try {
            val list = popupTodoList(body.component)
            assertEquals(2, list.rowCount())
            assertTrue(list.rowChecked(0))
            assertFalse(list.rowChecked(1))
            assertTrue(list.rowText(0).contains("<s>Done</s>"))
            assertTrue(list.rowText(1).contains("Next"))
            assertEquals(view.rowCheckBackground(0), list.rowCheckBackground(0))
            assertEquals(view.rowCheckForeground(0), list.rowCheckForeground(0))
            assertEquals(view.rowCheckBorder(0), list.rowCheckBorder(0))
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test todo header popup uses compact todo view rows`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED).also {
            it.todos = listOf(TodoDto("Hidden", "pending", "medium"))
            it.todoView = TodoViewDto(
                mode = "compact",
                todos = listOf(TodoDto("Visible", "pending", "high", changed = true)),
                hiddenBefore = 2,
                hiddenAfter = 3,
            )
        })
        view.toggle()
        val body = view.headerPopup()!!.build()
        try {
            val list = popupTodoList(body.component)
            assertEquals(1, list.rowCount())
            assertTrue(list.rowText(0).contains("Visible"))
            assertEquals(view.hiddenText(), list.hiddenText())
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test todo header popup is absent without todos`() {
        val view = TodoWriteView(tool("todowrite", ToolExecState.COMPLETED))
        view.toggle()
        assertNull(view.headerPopup())
    }

    private fun popupTodoList(root: JComponent): TodoListPanel {
        fun visit(component: JComponent): TodoListPanel? {
            if (component is TodoListPanel) return component
            return component.components.filterIsInstance<JComponent>().firstNotNullOfOrNull(::visit)
        }
        return visit(root) ?: error("TodoListPanel not found")
    }

    private fun tool(name: String, state: ToolExecState) = Tool("p1", name, toolKind(name)).also { it.state = state }
}
