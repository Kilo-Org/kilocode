package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionTargetResolver
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
import ai.kilocode.client.ui.diagram.ui.DiagramBlock
import ai.kilocode.client.ui.diagram.ui.DiagramPanel
import ai.kilocode.client.ui.diagram.ui.Diagrams
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.HyperlinkLabel
import com.intellij.util.ui.UIUtil
import java.awt.Point
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

    fun `test mermaid fence renders above toggle row and hides source`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        val children = block().components.toList()

        assertEquals(1, engine.calls)
        assertSame(diagram(), children.first())
        assertSame(row(), children.last())
        assertTrue(diagram().isVisible)
        assertFalse(codePane().isVisible)
    }

    fun `test block is the hover target and copies the fence text`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()
        block().setSize(400, 200)
        block().doLayout()

        val target = SessionTargetResolver.copy(block(), diagram(), Point(1, 1))

        assertSame(block(), target)
        assertEquals("flowchart TD\nA-->B\n", block().copyText())
        assertSame(block().copyToolbar, (target as SessionCopyTarget).copyToolbar)
    }

    fun `test toggle switches between diagram and source`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        toggle().doClick()

        assertFalse(diagram().isVisible)
        assertTrue(codePane().isVisible)

        toggle().doClick()

        assertTrue(diagram().isVisible)
        assertFalse(codePane().isVisible)
    }

    fun `test engine error keeps source visible`() {
        engine.out = Out.Err(ai.kilocode.client.ui.diagram.Fault.Syntax, "bad syntax")

        view.set("```mermaid\nflowchart TD\nA-->\n```")
        drain()

        assertFalse(diagram().isVisible)
        assertTrue(codePane().isVisible)
        assertTrue(labels().contains("bad syntax"))
    }

    fun `test streaming waits for closed fence`() {
        view.append("```mermaid\n")
        view.append("flowchart TD\n")
        view.append("A-->B\n")
        drain()

        assertEquals(0, engine.calls)
        assertTrue(codePane().isVisible)
        assertFalse(diagram().isVisible)

        view.append("```")
        drain()

        assertEquals(1, engine.calls)
        assertTrue(diagram().isVisible)
    }

    fun `test repeated set retains diagram view and does not leak editors`() {
        val base = EditorFactory.getInstance().allEditors.size

        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()
        val block = block()
        val panel = diagram()

        repeat(50) { i ->
            view.set("```mermaid\nflowchart TD\nA-->B$i\n```")
            drain()
            assertSame(block, block())
            assertSame(panel, diagram())
            assertEquals(3, block().components.size)
        }

        view.clear()
        UIUtil.dispatchAllInvocationEvents()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun drain() = coroutines.drain()

    private fun root() = view.component as JPanel

    private fun block() = descendants(root()).filterIsInstance<DiagramBlock>().single()

    private fun diagram() = descendants(root()).filterIsInstance<DiagramPanel>().single()

    private fun codePane() = block().components[1]

    private fun row() = block().components.last()

    private fun toggle() = descendants(root()).filterIsInstance<HyperlinkLabel>().single()

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
