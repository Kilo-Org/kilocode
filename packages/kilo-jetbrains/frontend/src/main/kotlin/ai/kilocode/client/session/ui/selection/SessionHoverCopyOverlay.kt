package ai.kilocode.client.session.ui.selection

import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.AWTEvent
import java.awt.Component
import java.awt.Container
import java.awt.Point
import java.awt.Rectangle
import java.awt.Toolkit
import java.awt.event.AWTEventListener
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

internal class SessionHoverCopyOverlay(
    private val root: JComponent,
    private val area: JComponent,
    parent: Disposable,
) : JPanel(null), Disposable {
    private var target: SessionCopyTarget? = null
    private val copy = SessionCopyButton(fill = true) { target?.copyText() }
    private val button = copy.button
    private var child: JComponent = button

    init {
        isVisible = false
        isOpaque = false
        add(button)

        val listener = AWTEventListener { event ->
            val mouse = event as? MouseEvent ?: return@AWTEventListener
            when (mouse.id) {
                MouseEvent.MOUSE_MOVED,
                MouseEvent.MOUSE_DRAGGED,
                MouseEvent.MOUSE_EXITED -> sync(mouse)
            }
        }
        Toolkit.getDefaultToolkit().addAWTEventListener(
            listener,
            AWTEvent.MOUSE_MOTION_EVENT_MASK or AWTEvent.MOUSE_EVENT_MASK,
        )
        Disposer.register(parent, this)
        Disposer.register(this) {
            Toolkit.getDefaultToolkit().removeAWTEventListener(listener)
        }
    }

    @RequiresEdt
    fun bounds(pane: JPanel, child: JComponent): Rectangle {
        val item = target ?: return Rectangle()
        val anchor = item.copyAnchor
        if (!anchor.isShowing || anchor.parent == null) return Rectangle()
        val visible = anchor.visibleRect
        if (visible.isEmpty) return Rectangle()
        val size = child.preferredSize
        val gap = JBUI.scale(4)
        val limit = limit(pane)
        if (limit.isEmpty) return Rectangle()
        if (item.copyToolbar != null && !item.copyCorner) {
            val pt = SwingUtilities.convertPoint(anchor, Point(visible.x, visible.y), pane)
            // A zero-height anchor is an inline header placeholder (edit/modified open-diff): center
            // the floating button on the header row so it lines up with the change badge. A real-height
            // anchor is a footer row (message/text copy): keep the button bottom-aligned inside it.
            // Targets that opt into corner placement fall through to the code-block positioning below.
            val inline = anchor.preferredSize.height == 0
            val offset = if (inline) (visible.height - size.height) / 2 else visible.height - size.height
            val x = clamp(pt.x + visible.width - size.width, limit.x, limit.x + limit.width - size.width)
            val y = clamp(pt.y + offset, limit.y, limit.y + limit.height - size.height)
            return Rectangle(x, y, size.width, size.height)
        }
        val pt = SwingUtilities.convertPoint(anchor, Point(visible.x + visible.width, visible.y), pane)
        val x = clamp(pt.x - size.width - gap, limit.x, limit.x + limit.width - size.width)
        val y = clamp(pt.y + gap, limit.y, limit.y + limit.height - size.height)
        return Rectangle(x, y, size.width, size.height)
    }

    private fun limit(pane: JPanel): Rectangle {
        if (!area.isShowing || area.parent == null) return Rectangle()
        val pt = SwingUtilities.convertPoint(area.parent, area.location, pane)
        return Rectangle(pt.x, pt.y, area.width, area.height)
    }

    private fun clamp(value: Int, min: Int, max: Int): Int {
        if (max < min) return min
        return value.coerceIn(min, max)
    }

    override fun doLayout() {
        child.setBounds(0, 0, width, height)
        layout(child)
    }

    override fun getPreferredSize() = child.preferredSize

    override fun getMinimumSize() = child.minimumSize

    override fun getMaximumSize() = child.maximumSize

    @RequiresEdt
    private fun sync(event: MouseEvent) {
        val src = event.component ?: return conceal()
        if (SessionTargetResolver.inside(this, src)) return retain()
        if (contains(target, src, event.point)) return
        val item = SessionTargetResolver.copy(root, src, event.point, this)
        if (item == null) {
            conceal()
            return
        }
        show(item)
    }

    @RequiresEdt
    private fun show(item: SessionCopyTarget) {
        if (target === item && isVisible) return
        target = item
        use(item.copyToolbar ?: button)
        isVisible = true
        parent?.doLayout()
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun retain() {
        if (target == null || isVisible) return
        isVisible = true
    }

    @RequiresEdt
    internal fun contains(item: SessionCopyTarget?, src: Component, point: Point): Boolean {
        val anchor = item?.copyAnchor ?: return false
        if (!SessionTargetResolver.inside(anchor, src)) return false
        val pt = SwingUtilities.convertPoint(src, point, anchor)
        return anchor.contains(pt)
    }

    @RequiresEdt
    fun clear() {
        conceal()
    }

    @RequiresEdt
    private fun conceal() {
        copy.dismiss()
        use(button)
        if (target == null && !isVisible) return
        target = null
        isVisible = false
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun use(comp: JComponent) {
        if (child === comp && comp.parent === this) return
        removeAll()
        child = comp
        add(child)
    }

    override fun dispose() {
        clear()
    }
}

private fun layout(comp: Component) {
    comp.doLayout()
    if (comp is Container) comp.components.forEach(::layout)
}
