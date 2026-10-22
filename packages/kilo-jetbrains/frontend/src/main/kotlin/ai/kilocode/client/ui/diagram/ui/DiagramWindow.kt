package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.ide.DataManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.FrameWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.WindowState
import com.intellij.openapi.wm.WindowManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Rectangle
import java.util.function.BooleanSupplier
import javax.swing.JComponent
import javax.swing.RootPaneContainer

private const val DIMENSION_KEY = "ai.kilocode.DiagramViewer"
private const val SHARE = 0.75

internal fun diagramWindowBounds(frame: Rectangle): Rectangle {
    val w = (frame.width * SHARE).toInt().coerceAtLeast(1)
    val h = (frame.height * SHARE).toInt().coerceAtLeast(1)
    val x = frame.x + (frame.width - w) / 2
    val y = frame.y + (frame.height - h) / 2
    return Rectangle(x, y, w, h)
}

internal interface DiagramHandle : Disposable {
    fun show()
    fun focus()
}

@Service(Service.Level.PROJECT)
internal class DiagramWindows internal constructor(
    project: Project,
    private val factory: (String) -> DiagramHandle,
    private val send: (String, Map<String, String>) -> Unit,
) {
    constructor(project: Project) : this(project, { source -> FrameHandle(project, source) }, Telemetry::send)

    private val windows = mutableMapOf<String, DiagramHandle>()

    @RequiresEdt
    fun open(source: String): Boolean {
        val token = service<DiagramStore>().put(source)
        val handle = windows[token]
        if (handle != null) {
            handle.focus()
            track(true)
            return true
        }
        val next = factory(source)
        windows[token] = next
        Disposer.register(next) {
            if (windows[token] === next) windows.remove(token)
        }
        next.show()
        track(false)
        return true
    }

    @RequiresEdt
    fun closeAll() {
        val all = windows.values.toList()
        windows.clear()
        all.forEach(Disposer::dispose)
    }

    private fun track(reused: Boolean) {
        send(
            "Diagram Viewer Opened",
            mapOf(
                "surface" to "session",
                "reused" to reused.toString(),
            ),
        )
    }
}

private class FrameHandle(project: Project, source: String) : DiagramHandle {
    private val frame = DiagramFrame(project).apply {
        component = diagramContent(source, this)
        preferredFocusedComponent = component
        closeOnEsc()
        setOnCloseHandler(BooleanSupplier {
            Disposer.dispose(this@FrameHandle)
            false
        })
    }

    override fun show() {
        frame.show(true)
    }

    override fun focus() {
        val window = frame.getFrame()
        window.toFront()
        window.requestFocus()
    }

    override fun dispose() {
        if (!frame.isDisposed) Disposer.dispose(frame)
    }
}

/**
 * A frame rather than a dialog on purpose.
 *
 * The viewer is a document surface, so it belongs in the Window menu and should live on its own
 * instead of floating over the IDE frame. It also keeps the window closer to the editor tab, which
 * matters for trackpad zoom: magnification is routed per window by the platform's
 * [com.intellij.openapi.actionSystem.impl.MouseGestureManager], and the editor tab (a plain IDE
 * frame) is the surface where that routing is known to reach our canvas.
 */
private class DiagramFrame(private val project: Project) : FrameWrapper(
    project,
    DIMENSION_KEY,
    false,
    KiloBundle.message("diagram.title"),
) {
    override fun loadFrameState(state: WindowState?) {
        if (state != null) {
            super.loadFrameState(state)
            return
        }
        val base = WindowManager.getInstance().getFrame(project)?.bounds
        if (base == null) {
            super.loadFrameState(null)
            return
        }
        getFrame().bounds = diagramWindowBounds(base)
        (getFrame() as RootPaneContainer).rootPane.revalidate()
    }
}

@RequiresEdt
internal fun openDiagramWindow(anchor: JComponent, source: String): Boolean {
    val ctx = DataManager.getInstance().getDataContext(anchor)
    val project = CommonDataKeys.PROJECT.getData(ctx) ?: return false
    return project.service<DiagramWindows>().open(source)
}
