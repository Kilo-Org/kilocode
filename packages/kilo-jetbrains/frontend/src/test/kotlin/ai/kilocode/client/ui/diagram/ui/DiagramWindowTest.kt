package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Rectangle

/**
 * Covers the window bookkeeping without opening a real window: [DiagramWindows] takes its handle
 * factory as a dependency, so the reuse, dispose and telemetry paths are exercised against fakes
 * while the [com.intellij.openapi.ui.FrameWrapper] wiring stays out of the test.
 */
class DiagramWindowTest : BasePlatformTestCase() {
    private val events = mutableListOf<Pair<String, Map<String, String>>>()
    private val handles = mutableListOf<FakeHandle>()

    fun `test bounds take three quarters of the frame and stay centred`() {
        val bounds = diagramWindowBounds(Rectangle(100, 50, 1000, 800))

        assertEquals(Rectangle(225, 150, 750, 600), bounds)
    }

    fun `test bounds survive a degenerate frame`() {
        val bounds = diagramWindowBounds(Rectangle(0, 0, 1, 1))

        assertEquals(Rectangle(0, 0, 1, 1), bounds)
    }

    fun `test the same source reuses one window and a different source opens another`() = edtWait {
        val windows = windows()

        assertTrue(windows.open("flowchart TD\nA-->B"))

        assertEquals(1, handles.size)
        assertEquals(1, handles.single().shown)
        assertEquals(0, handles.single().focused)

        assertTrue(windows.open("flowchart TD\nA-->B"))

        assertEquals(1, handles.size)
        assertEquals(1, handles.single().shown)
        assertEquals(1, handles.single().focused)

        assertTrue(windows.open("flowchart TD\nA-->C"))

        assertEquals(2, handles.size)
        assertEquals(listOf(1, 1), handles.map { it.shown })
    }

    fun `test disposing a window drops it so the next click opens a fresh one`() = edtWait {
        val windows = windows()
        windows.open("flowchart TD\nA-->B")

        Disposer.dispose(handles.single())
        windows.open("flowchart TD\nA-->B")

        assertEquals(2, handles.size)
        assertEquals(0, handles.last().focused)
        assertEquals(1, handles.last().shown)
    }

    fun `test closeAll disposes every open window`() = edtWait {
        val windows = windows()
        windows.open("flowchart TD\nA-->B")
        windows.open("flowchart TD\nA-->C")

        windows.closeAll()
        windows.open("flowchart TD\nA-->B")

        assertEquals(listOf(1, 1, 0), handles.map { it.disposed })
        assertEquals(3, handles.size)
    }

    fun `test opening reports whether the window was reused`() = edtWait {
        val windows = windows()

        windows.open("flowchart TD\nA-->B")
        windows.open("flowchart TD\nA-->B")

        assertEquals(listOf("Diagram Viewer Opened", "Diagram Viewer Opened"), events.map { it.first })
        assertEquals(listOf("false", "true"), events.map { it.second["reused"] })
        assertEquals(listOf("session", "session"), events.map { it.second["surface"] })
    }

    private fun windows() = DiagramWindows(
        project,
        { FakeHandle().also(handles::add) },
        { event, props -> events.add(event to props) },
    )

    private class FakeHandle : DiagramHandle {
        var shown = 0
            private set
        var focused = 0
            private set
        var disposed = 0
            private set

        override fun show() {
            shown++
        }

        override fun focus() {
            focused++
        }

        override fun dispose() {
            disposed++
        }
    }
}
