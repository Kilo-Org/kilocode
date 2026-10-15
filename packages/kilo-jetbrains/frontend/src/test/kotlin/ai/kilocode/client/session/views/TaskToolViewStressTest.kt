package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.TaskToolView
import ai.kilocode.client.ui.layout.Stack
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container

@Suppress("UnstableApiUsage")
class TaskToolViewStressTest : BasePlatformTestCase() {
    private val views = mutableListOf<TaskToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test child tool churn retains rows and stays bounded`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = view(task(children = children(3)))
        val first = rows(view)[0]
        val second = rows(view)[1]
        // The task's own child session id never changes across this churn, so its generated-avatar
        // glyph must stay the exact same retained icon instance the whole time (see [AgentAvatar]).
        val avatar = glyph(view).icon

        repeat(120) { i ->
            val count = 4 + i % 25
            view.update(task(children = children(count)))
            assertSame(first, rows(view)[0])
            assertSame(second, rows(view)[1])
            assertEquals(count, rows(view).size)
            assertSame(avatar, glyph(view).icon)
        }

        repeat(80) { i ->
            val ids = listOf("c1", "c2") + (4..(8 + i % 10)).map { "c$it" }
            view.update(task(children = ids.map { child(it, if (it == "c2" && i % 2 == 0) "grep" else "read") }))
            assertSame(first, rows(view)[0])
            assertSame(second, rows(view)[1])
            assertEquals(ids.size, rows(view).size)
        }

        view.collapse()
        drainEdt()

        assertFalse(view.isExpanded())
        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun view(tool: Tool): TaskToolView = TaskToolView(tool).also { views.add(it) }

    private fun task(children: List<Tool> = emptyList()) = Tool("part_task", "task", toolKind("task")).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("subagent_type" to "explore", "description" to "Find files")
        it.metadata = mapOf("sessionId" to "ses_child")
        it.childSessionId = "ses_child"
        it.childTools = children
    }

    private fun child(id: String, name: String) = Tool(id, name, toolKind(name)).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("filePath" to "src/Main.kt", "pattern" to "query")
    }

    private fun children(count: Int) = (1..count).map { child("c$it", "read") }

    private fun rows(view: TaskToolView): List<Component> {
        val scroll = descendants(view).filterIsInstance<JBScrollPane>().single()
        val stack = descendants(scroll.viewport.view).filterIsInstance<Stack>().single()
        return stack.components.toList()
    }

    private fun descendants(root: Component): List<Component> {
        if (root !is Container) return emptyList()
        return root.components.flatMap { child -> listOf(child) + descendants(child) }
    }

    /** The task card's leading generated-avatar glyph: the one icon-only, text-less header label. */
    private fun glyph(view: TaskToolView) = descendants(view).filterIsInstance<JBLabel>().first { it.text.isNullOrBlank() && it.icon != null }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
