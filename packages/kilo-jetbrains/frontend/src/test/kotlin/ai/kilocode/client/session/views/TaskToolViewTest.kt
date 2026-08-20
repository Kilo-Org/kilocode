package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.tool.TaskToolView
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Color
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class TaskToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<TaskToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test task header shows agent description and count`() {
        val view = view(task(children = listOf(child("c1", "read"), child("c2", "grep"))))

        assertTrue(view.dumpLabel().contains("Explore Agent"))
        assertTrue(view.dumpLabel().contains("Find files (2)"))
        assertEquals(2, rows(view).size)
        assertTrue(view.isExpanded())
    }

    fun `test update adds child row without replacing existing rows`() {
        val view = view(task(children = listOf(child("c1", "read"))))
        val before = rowText(view).first()

        view.update(task(children = listOf(child("c1", "read"), child("c2", "grep"))))

        assertEquals(2, rows(view).size)
        assertEquals(before, rowText(view).first())
        assertTrue(rowText(view).any { it.contains("Grep") })
    }

    fun `test removing child rows collapses body`() {
        val view = view(task(children = listOf(child("c1", "read"))))

        view.update(task(children = emptyList()))

        assertFalse(view.isExpanded())
        assertNull(scroll(view))
    }

    fun `test body is lazy until child tools arrive`() {
        val view = view(task(children = emptyList()))

        assertNull(scroll(view))
        view.update(task(children = listOf(child("c1", "read"))))

        assertNotNull(scroll(view))
        assertTrue(view.isExpanded())
    }

    fun `test collapsed task body stays collapsed on child update`() {
        val view = view(task(children = listOf(child("c1", "read"))))

        view.collapse()
        view.update(task(children = listOf(child("c1", "grep"))))

        assertFalse(view.isExpanded())
        view.expand()
        assertTrue(rowText(view).single().contains("Grep"))
        assertTrue(rowText(view).single().contains("pattern=query"))
    }

    fun `test expanded task body is capped to ten rows`() {
        val view = view(task(children = children(20)))
        val taller = view(task(children = children(80)))

        assertEquals(10, SessionUiStyle.View.Tool.TASK_LINES)
        assertTrue(view.preferredSize.height > 0)
        assertEquals(view.preferredSize.height, taller.preferredSize.height)
    }

    fun `test task body uses nested vertical scroll`() {
        val view = view(task(children = children(20)))
        val scroll = scroll(view)!!

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, scroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, scroll.verticalScrollBarPolicy)
    }

    fun `test child tool titles use target color`() {
        val view = view(task(children = listOf(child("c1", "read"), child("c2", "grep", ToolExecState.ERROR))))

        assertColor(SessionUiStyle.Text.Secondary.foreground(), titleColor(view, 0))
        assertColor(UiStyle.Colors.errorLabelForeground(), titleColor(view, 1))
    }

    fun `test task body is indented beyond header padding`() {
        val view = view(task(children = listOf(child("c1", "read"))))
        val insets = body(view).border.getBorderInsets(body(view))

        assertTrue(insets.left > JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING))
        assertEquals(UiStyle.Gap.sm(), insets.top)
        assertEquals(UiStyle.Gap.sm(), insets.bottom)
    }

    fun `test appended child tools scroll nested body to bottom`() {
        val view = view(task(children = children(40)))
        view.setSize(300, view.preferredSize.height)
        view.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        val scroll = scroll(view)!!
        scroll.verticalScrollBar.value = bottom(scroll) - 1

        view.update(task(children = children(70)))
        UIUtil.dispatchAllInvocationEvents()
        UIUtil.dispatchAllInvocationEvents()
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(bottom(scroll), scroll.verticalScrollBar.value)
    }

    fun `test appended child tools do not yank nested body above tail`() {
        val view = view(task(children = children(40)))
        view.setSize(300, view.preferredSize.height)
        view.doLayout()
        UIUtil.dispatchAllInvocationEvents()
        val scroll = scroll(view)!!
        scroll.verticalScrollBar.value = 0

        view.update(task(children = children(70)))
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(0, scroll.verticalScrollBar.value)
    }

    fun `test open subagent action is eligible only with child session and callback`() {
        val closed = view(task(), onOpen = null)
        val opened = view(task(), onOpen = { _, _ -> })
        val missing = view(task(sessionId = null), onOpen = { _, _ -> })

        assertFalse(closed.copyEligible)
        assertTrue(opened.copyEligible)
        assertFalse(missing.copyEligible)
    }

    fun `test open subagent action invokes callback without toggling body`() {
        val calls = mutableListOf<Pair<String, String>>()
        val view = view(task(), onOpen = { id, title -> calls.add(id to title) })

        openIcon(view).doClick()

        assertEquals(listOf("ses_child" to "Explore Agent - Find files"), calls)
        assertFalse(view.isExpanded())
    }

    fun `test task popup only shows when collapsed with children`() {
        val view = view(task(children = listOf(child("c1", "read"))))
        assertTrue(view.isExpanded())
        assertNull(view.headerPopup())

        view.collapse()
        assertNotNull(view.headerPopup())

        val empty = view(task(children = emptyList()))
        assertNull(empty.headerPopup())
    }

    fun `test collapsed task popup hosts the live expanded body`() {
        val view = view(task(children = listOf(child("c1", "read"))))
        val live = scroll(view)
        assertNotNull(live)

        view.collapse()
        assertNull(scroll(view))

        val popup = view.headerPopup()!!.build()
        try {
            // The popup hosts the same live scroll instance, not a rebuilt snapshot.
            assertTrue(descendants(popup.component).any { it === live })
        } finally {
            Disposer.dispose(popup.disposable)
        }

        // Disposing the popup detaches the shared body without destroying it; re-expanding reuses it.
        assertNull(live!!.parent)
        view.expand()
        assertSame(live, scroll(view))
    }

    fun `test collapsed task popup is a bounded scrollable box`() {
        val view = view(task(children = children(40)))
        view.collapse()

        val popup = view.headerPopup()!!.build()
        try {
            // Fixed height cap, width bounded by the wide popup cap, and both scrollbars present so
            // streaming content scrolls instead of resizing the balloon.
            assertEquals(JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT), popup.component.preferredSize.height)
            assertTrue(popup.component.preferredSize.width <= JBUI.scale(SessionUiStyle.View.Popup.WIDE_MAX_WIDTH))
            val scrolls = descendants(popup.component).filterIsInstance<JBScrollPane>()
            assertTrue(scrolls.any { it.horizontalScrollBarPolicy == ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED })
            assertTrue(scrolls.any { it.verticalScrollBarPolicy == ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED })
        } finally {
            Disposer.dispose(popup.disposable)
        }
    }

    fun `test collapsed task popup reflects streaming child updates`() {
        val view = view(task(children = listOf(child("c1", "read"))))
        val live = scroll(view)
        view.collapse()

        val popup = view.headerPopup()!!.build()
        try {
            assertEquals(1, popupRows(popup.component).size)
            view.update(task(children = listOf(child("c1", "read"), child("c2", "grep"))))
            assertEquals(2, popupRows(popup.component).size)
        } finally {
            Disposer.dispose(popup.disposable)
        }

        assertNull(live!!.parent)
        view.expand()
        assertSame(live, scroll(view))
        assertEquals(2, rows(view).size)
    }

    fun `test open action reserves width even with a long summary`() {
        val view = view(task(children = listOf(child("c1", "read")), description = "d".repeat(400)))
        // A narrow header would starve a trailing child in the fill slot; the left group must not.
        realize(view, JBUI.scale(320), JBUI.scale(160))

        val anchor = view.copyAnchor
        assertTrue(anchor.preferredSize.width > 0)
        assertEquals(anchor.preferredSize.width, anchor.width)
    }

    private fun realize(component: Component, width: Int, height: Int) {
        component.setSize(width, height)
        if (component is Container) {
            component.doLayout()
            component.components.forEach { realize(it, it.width, it.height) }
        }
    }

    private fun view(tool: Tool, onOpen: ((String, String) -> Unit)? = null): TaskToolView = TaskToolView(tool, onOpenSubagent = onOpen).also { views.add(it) }

    private fun task(children: List<Tool> = emptyList(), sessionId: String? = "ses_child", description: String = "Find files") = Tool("part_task", "task", toolKind("task")).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("subagent_type" to "explore", "description" to description)
        it.metadata = sessionId?.let { id -> mapOf("sessionId" to id) }.orEmpty()
        it.childSessionId = sessionId
        it.childTools = children
    }

    private fun child(id: String, name: String, state: ToolExecState = ToolExecState.COMPLETED) = Tool(id, name, toolKind(name)).also {
        it.state = state
        it.input = mapOf("filePath" to "src/Main.kt", "pattern" to "query")
    }

    private fun children(count: Int) = (1..count).map { child("c$it", "read") }

    private fun scroll(view: TaskToolView): JBScrollPane? = descendants(view).filterIsInstance<JBScrollPane>().singleOrNull()

    private fun body(view: TaskToolView) = scroll(view)!!.viewport.view as JComponent

    private fun rows(view: TaskToolView): List<Component> {
        val stack = descendants(body(view)).filterIsInstance<Stack>().singleOrNull() ?: return emptyList()
        return stack.components.toList()
    }

    // The open button is a hover overlay, not a header child, so read it from the copy toolbar.
    private fun openIcon(view: TaskToolView) = view.copyToolbar as HoverIcon

    private fun popupRows(component: Component): List<Component> =
        descendants(component).filterIsInstance<Stack>().single().components.toList()

    private fun rowText(view: TaskToolView) = rows(view).map { row ->
        descendants(row).filterIsInstance<JBLabel>().mapNotNull { label -> label.text.takeIf { it.isNotBlank() } }.joinToString(" ")
    }

    private fun titleColor(view: TaskToolView, index: Int) = descendants(rows(view)[index])
        .filterIsInstance<JBLabel>()
        .first { it.text.isNotBlank() }
        .foreground

    private fun descendants(root: Component): List<Component> {
        if (root !is Container) return emptyList()
        return root.components.flatMap { child -> listOf(child) + descendants(child) }
    }

    private fun bottom(scroll: JBScrollPane): Int {
        val view = scroll.viewport.view ?: return 0
        return maxOf(0, view.height - scroll.viewport.extentSize.height)
    }

    private fun assertColor(expected: Color, actual: Color?) {
        assertNotNull(actual)
        assertEquals(expected.rgb, actual!!.rgb)
    }
}
