package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.selection.SessionCopyButton
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.Art
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.toolbarButton
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLayeredPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Cursor
import java.awt.Point
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import java.awt.event.MouseWheelListener
import javax.swing.Icon
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

/**
 * Reusable zoomable diagram surface: a scrollable [DiagramCanvas] with floating zoom controls.
 *
 * Shared by the diagram editor tab and the detached diagram window. Zoom comes from four sources:
 * trackpad pinch (via the canvas [com.intellij.ui.components.Magnificator]), Ctrl/Cmd + wheel, the
 * overlay buttons, and a double click to fit again. Dragging pans whenever the scaled diagram
 * overflows the viewport, and the overlay can copy the diagram as a picture.
 */
internal class DiagramViewer(palette: Palette) : JBLayeredPane() {
    private val canvas = DiagramCanvas(palette)
    private val scroll = JBScrollPane(canvas).apply {
        border = JBUI.Borders.empty()
        viewportBorder = JBUI.Borders.empty()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }
    private val copy = SessionCopyButton(
        tooltip = KiloBundle.message("diagram.copy"),
        icon = AllIcons.Actions.Copy,
        image = { canvas.image() },
    ) { null }
    // Built by chaining rather than `apply`, so these lambdas cannot bind to Stack's own fit().
    private val controls = Stack.vertical(UiStyle.Gap.xs())
        .next(control(AllIcons.General.ZoomIn, "diagram.zoom.in") { zoomIn() })
        .next(control(AllIcons.General.ZoomOut, "diagram.zoom.out") { zoomOut() })
        .next(control(AllIcons.General.FitContent, "diagram.zoom.fit") { fit() })
        .gap(UiStyle.Gap.md())
        .next(copy.button)
    private val wheel = Wheel()
    private val drag = Drag()
    private val click = Click()

    init {
        // Layer first, then add: add(Component, Int) binds to Container.add(comp, index) from Kotlin,
        // so the layer would be taken as an insertion index and both children would end up in the
        // default layer, with the scroll pane painting over the controls and swallowing their clicks.
        setLayer(scroll, DEFAULT_LAYER)
        setLayer(controls, PALETTE_LAYER)
        add(scroll)
        add(controls)
        scroll.addMouseWheelListener(wheel)
        canvas.addMouseListener(drag)
        canvas.addMouseMotionListener(drag)
        canvas.addMouseListener(click)
    }

    @RequiresEdt
    fun art(value: Art) {
        canvas.art(value)
    }

    @RequiresEdt
    fun palette(value: Palette) {
        canvas.palette(value)
    }

    /** Paints the diagram surface (canvas and viewport) with [color]. */
    @RequiresEdt
    fun surface(color: Color) {
        background = color
        scroll.background = color
        scroll.viewport.background = color
        canvas.background = color
    }

    @RequiresEdt
    fun zoomIn(at: Point? = null) {
        canvas.zoom(canvas.scale() * STEP, at)
    }

    @RequiresEdt
    fun zoomOut(at: Point? = null) {
        canvas.zoom(canvas.scale() / STEP, at)
    }

    @RequiresEdt
    fun fit() {
        canvas.fit()
    }

    override fun removeNotify() {
        copy.dismiss()
        super.removeNotify()
    }

    override fun doLayout() {
        scroll.setBounds(0, 0, width, height)
        val size = controls.preferredSize
        controls.setBounds(width - size.width - UiStyle.Gap.pad(), UiStyle.Gap.pad(), size.width, size.height)
        controls.doLayout()
    }

    /** Double click is the usual "show me all of it again" gesture in image and diagram viewers. */
    private inner class Click : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (e.button != MouseEvent.BUTTON1 || e.clickCount != 2) return
            fit()
        }
    }

    private inner class Wheel : MouseWheelListener {
        override fun mouseWheelMoved(e: MouseWheelEvent) {
            if (!e.isControlDown && !e.isMetaDown) return
            val at = SwingUtilities.convertPoint(e.component, e.point, scroll.viewport)
            if (e.wheelRotation < 0) zoomIn(at)
            if (e.wheelRotation > 0) zoomOut(at)
            e.consume()
        }
    }

    private inner class Drag : MouseAdapter() {
        private var from: Point? = null
        private var origin: Point? = null

        override fun mousePressed(e: MouseEvent) {
            if (e.button != MouseEvent.BUTTON1 || !overflows()) return
            from = e.point
            origin = scroll.viewport.viewPosition
            canvas.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        override fun mouseDragged(e: MouseEvent) {
            val start = from ?: return
            val base = origin ?: return
            val at = Point(base.x + start.x - e.x, base.y + start.y - e.y)
            scroll.viewport.viewPosition = clamped(scroll.viewport, at)
        }

        override fun mouseReleased(e: MouseEvent) {
            release()
        }

        override fun mouseExited(e: MouseEvent) {
            release()
        }

        private fun release() {
            if (from == null) return
            from = null
            origin = null
            canvas.cursor = Cursor.getDefaultCursor()
        }

        private fun overflows(): Boolean {
            val viewport = scroll.viewport
            val view = viewport.view ?: return false
            return view.width > viewport.extentSize.width || view.height > viewport.extentSize.height
        }
    }

    private companion object {
        const val STEP = 1.25

        fun control(icon: Icon, key: String, handler: () -> Unit) =
            toolbarButton(ToolbarButtonAction(icon, KiloBundle.message(key), handler))
    }
}
