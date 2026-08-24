package ai.kilocode.client.ui.md

import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import ai.kilocode.client.ui.diagram.ui.DiagramPanel
import ai.kilocode.client.ui.diagram.ui.Diagrams
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.EditorTextField
import com.intellij.util.ui.UIUtil
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class MdViewDiagramTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var engine: FakeEngine
    private lateinit var view: MdView

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        engine = FakeEngine()
        ApplicationManager.getApplication().replaceService(Diagrams::class.java, Diagrams(coroutines.scope, engine), testRootDisposable)
        view = MdViewFactory.hybrid()
    }

    override fun tearDown() {
        try {
            if (this::view.isInitialized) Disposer.dispose(view)
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun `test mermaid fence renders and hides source`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        assertEquals(1, diagrams().size)
        assertEquals(0, editors().size)
        assertEquals(1, engine.calls)
    }

    fun `test engine error keeps source visible`() {
        engine.out = Out.Err(ai.kilocode.client.ui.diagram.Fault.Syntax, "bad syntax")

        view.set("```mermaid\nflowchart TD\nA-->\n```")
        drain()

        assertEquals(0, diagrams().size)
        assertEquals(1, editors().size)
        assertTrue(labels().contains("bad syntax"))
    }

    fun `test streaming waits for closed fence`() {
        view.append("```mermaid\n")
        view.append("flowchart TD\n")
        view.append("A-->B\n")
        drain()

        assertEquals(0, engine.calls)
        assertEquals(1, editors().size)

        view.append("```")
        drain()

        assertEquals(1, engine.calls)
        assertEquals(1, diagrams().size)
    }

    fun `test repeated set retains diagram view and does not leak editors`() {
        val base = EditorFactory.getInstance().allEditors.size

        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()
        val panel = diagramContainers().single()

        repeat(50) { i ->
            view.set("```mermaid\nflowchart TD\nA-->B$i\n```")
            drain()
            assertSame(panel, diagramContainers().single())
        }

        view.clear()
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun drain() = coroutines.drain()

    private fun root() = view.component as JPanel

    private fun diagramContainers() = root().components.filterIsInstance<ai.kilocode.client.ui.layout.Stack>()

    private fun diagrams() = descendants(root()).filterIsInstance<DiagramPanel>()

    private fun editors() = descendants(root()).filterIsInstance<EditorTextField>()

    private fun labels() = descendants(root()).joinToString("\n") { (it as? javax.swing.JLabel)?.text.orEmpty() }

    private fun descendants(root: java.awt.Container): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        for (comp in root.components) {
            out.add(comp)
            if (comp is java.awt.Container) out.addAll(descendants(comp))
        }
        return out
    }

    private class FakeEngine : Engine {
        var calls = 0
        var out: Out? = null

        override fun accepts(type: Type) = true

        override suspend fun draw(source: String, spec: Spec): Out {
            calls++
            return out ?: Out.Ok(
                Scene(
                    Type.Flowchart,
                    listOf(Mark.Edge(listOf(Pt(10.0, 10.0), Pt(80.0, 10.0)), Role.Line, head = ai.kilocode.client.ui.diagram.Head.Arrow)),
                    Size(100.0, 30.0),
                ),
            )
        }
    }
}
