package ai.kilocode.client.ui.md

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionTargetResolver
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Pt
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import ai.kilocode.client.ui.diagram.ui.DiagramBlock
import ai.kilocode.client.ui.diagram.ui.DiagramHandle
import ai.kilocode.client.ui.diagram.ui.DiagramPanel
import ai.kilocode.client.ui.diagram.ui.DiagramWindows
import ai.kilocode.client.ui.diagram.ui.Diagrams
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.LoggedErrorProcessor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.util.ui.UIUtil
import java.awt.Cursor
import java.awt.Point
import java.awt.datatransfer.DataFlavor
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.AbstractButton
import javax.swing.JComponent
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

    fun `test mermaid fence renders above status label and hides source`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        val children = block().components.toList()

        assertEquals(1, engine.calls)
        assertSame(diagram(), children.first())
        assertSame(label(), children.last())
        assertTrue(diagram().isVisible)
        assertFalse(codePane().isVisible)
        assertFalse("a rendered diagram leaves no status row behind", label().isVisible)
    }

    fun `test block anchors its toolbar in the corner like a code block`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        assertTrue(block().copyCorner)
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

    fun `test clicking a rendered diagram opens the viewer window`() {
        val opened = windows()
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()
        attach()

        click(diagram())

        assertEquals(listOf("flowchart TD\nA-->B\n"), opened)
        assertEquals(Cursor.HAND_CURSOR, diagram().cursor.type)
    }

    fun `test the streaming source fallback is not a viewer trigger`() {
        // Only the rendered diagram opens the window, so the source pane shown while a fence streams
        // (and after an engine error) keeps its plain text behaviour.
        val opened = windows()
        view.append("```mermaid\nflowchart TD\n")
        drain()
        attach()

        click(codePane() as JComponent)
        click(diagram())

        assertTrue(codePane().isVisible)
        assertFalse(diagram().isVisible)
        assertTrue(opened.isEmpty())
    }

    fun `test copying a rendered diagram puts a picture on the clipboard`() {
        view.set("```mermaid\nflowchart TD\nA-->B\n```")
        drain()

        copyButton().doClick()

        val image = CopyPasteManager.getInstance().contents?.getTransferData(DataFlavor.imageFlavor) as BufferedImage
        assertTrue(image.width > 0 && image.height > 0)
    }

    fun `test copying a streaming fence still copies its source`() {
        // The source pane is what the reader sees until the fence closes, so copy follows the text.
        view.append("```mermaid\nflowchart TD\n")
        drain()

        copyButton().doClick()

        val contents = CopyPasteManager.getInstance().contents!!
        assertFalse(contents.isDataFlavorSupported(DataFlavor.imageFlavor))
        assertEquals("flowchart TD", (contents.getTransferData(DataFlavor.stringFlavor) as String).trim())
    }

    fun `test engine error keeps source visible`() {
        engine.out = Out.Err(Fault.Syntax, "bad syntax")

        view.set("```mermaid\nflowchart TD\nA-->\n```")
        drain()

        assertFalse(diagram().isVisible)
        assertTrue(codePane().isVisible)
        assertTrue(label().isVisible)
        assertTrue(labels().contains("bad syntax"))
        assertEquals(UiStyle.Colors.errorLabelForeground(), label().foreground)
    }

    /**
     * `zenuml` and other types this engine does not draw are still valid mermaid. Marking them
     * red would report working markdown as broken, so they read as a note over the source instead.
     */
    fun `test an unsupported diagram type reads as a note rather than an error`() {
        engine.out = Out.Err(Fault.Unsupported, "unsupported diagram type: Unknown")

        view.set("```mermaid\nzenuml\nA->B: hi\n```")
        drain()

        assertFalse(diagram().isVisible)
        assertTrue(codePane().isVisible)
        assertTrue(labels().contains(KiloBundle.message("diagram.unsupported")))
        assertFalse("the engine's internal wording should not reach the reader", labels().contains("unsupported diagram type"))
        assertEquals(SessionUiStyle.Text.Secondary.foreground(), label().foreground)
    }

    /** A crash in the engine has to land on the same source fallback as a refusal, and be logged. */
    fun `test an engine crash keeps source visible and is logged`() {
        engine.fail = IllegalStateException("boom")

        val logged = LoggedErrorProcessor.executeAndReturnLoggedError {
            view.set("```mermaid\nflowchart TD\nA-->B\n```")
            drain()
        }

        assertEquals("boom", logged.message)
        assertFalse(diagram().isVisible)
        assertTrue(codePane().isVisible)
        assertTrue(labels().contains("boom"))
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

    /** Records the sources the transcript hands to the viewer window instead of opening one. */
    private fun windows(): List<String> {
        val opened = mutableListOf<String>()
        val service = DiagramWindows(project, { source -> opened.add(source); NoopHandle() }, { _, _ -> })
        project.replaceService(DiagramWindows::class.java, service, testRootDisposable)
        return opened
    }

    /** Puts the transcript under a project data provider so the click can resolve the project. */
    private fun attach() {
        val panel = DataPanel(project)
        panel.add(root())
        panel.setSize(400, 400)
        panel.doLayout()
    }

    private fun click(target: JComponent) {
        target.dispatchEvent(
            MouseEvent(
                target,
                MouseEvent.MOUSE_CLICKED,
                System.currentTimeMillis(),
                0,
                1,
                1,
                1,
                false,
                MouseEvent.BUTTON1,
            ),
        )
    }

    /** The block's toolbar is only parented while the hover overlay shows it, so reach it directly. */
    private fun copyButton() = descendants(block().copyToolbar!!)
        .filterIsInstance<AbstractButton>()
        .single { it.toolTipText == KiloBundle.message("session.copy.hover") }

    private fun root() = view.component as JPanel

    private fun block() = descendants(root()).filterIsInstance<DiagramBlock>().single()

    private fun diagram() = descendants(root()).filterIsInstance<DiagramPanel>().single()

    private fun codePane() = block().components[1]

    private fun label() = block().components.last() as javax.swing.JLabel

    private fun labels() = descendants(root()).joinToString("\n") { (it as? javax.swing.JLabel)?.text.orEmpty() }

    private fun descendants(root: java.awt.Container): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        for (comp in root.components) {
            out.add(comp)
            if (comp is java.awt.Container) out.addAll(descendants(comp))
        }
        return out
    }

    private class DataPanel(private val project: Project) : JPanel(), UiDataProvider {
        override fun uiDataSnapshot(sink: DataSink) {
            sink[CommonDataKeys.PROJECT] = project
        }
    }

    private class NoopHandle : DiagramHandle {
        override fun show() = Unit

        override fun focus() = Unit

        override fun dispose() = Unit
    }

    private class FakeEngine : Engine {
        var calls = 0
        var out: Out? = null
        var fail: Exception? = null

        override fun accepts(type: Type) = true

        override suspend fun draw(source: String, spec: Spec): Out {
            calls++
            fail?.let { throw it }
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
