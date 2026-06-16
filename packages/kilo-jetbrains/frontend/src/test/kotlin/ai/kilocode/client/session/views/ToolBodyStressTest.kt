package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.GlobToolView
import ai.kilocode.client.session.views.tool.SearchToolView
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil

@Suppress("UnstableApiUsage")
class ToolBodyStressTest : BasePlatformTestCase() {

    fun `test expanded generic tool body editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(60) { i ->
            val view = ToolView(tool(i))
            view.toggle()
            view.bodyEditor()?.getEditor(true)
            Disposer.dispose(view)
        }
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test expanded shell tool editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(60) { i ->
            val view = ShellToolView(shell(i))
            view.toggle()
            view.codeEditors().forEach { it.getEditor(true) }
            Disposer.dispose(view)
        }
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test expanded search tool editors are disposed after churn`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(60) { i ->
            val search = SearchToolView(search(i))
            search.toggle()
            search.bodyEditor()?.getEditor(true)
            Disposer.dispose(search)

            val glob = GlobToolView(glob(i))
            glob.toggle()
            glob.bodyEditor()?.getEditor(true)
            Disposer.dispose(glob)
        }
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun tool(index: Int) = Tool("p$index", "mystery", toolKind("mystery")).also {
        it.state = ToolExecState.COMPLETED
        it.output = (1..20).joinToString("\n") { line -> "line $index/$line" }
    }

    private fun shell(index: Int) = Tool("p$index", "bash", toolKind("bash")).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("command" to "log $index")
        it.output = (1..20).joinToString("\n") { line -> "line $index/$line" }
    }

    private fun search(index: Int) = Tool("s$index", "grep", toolKind("grep")).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("path" to "src", "pattern" to "needle$index", "include" to "*.kt")
        it.output = (1..20).joinToString("\n") { line -> "src/File$line.kt: needle$index" }
    }

    private fun glob(index: Int) = Tool("g$index", "glob", toolKind("glob")).also {
        it.state = ToolExecState.COMPLETED
        it.input = mapOf("path" to "src", "pattern" to "**/*$index.kt")
        it.output = (1..20).joinToString("\n") { line -> "src/File$line.kt" }
    }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
