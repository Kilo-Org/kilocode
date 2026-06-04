package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

abstract class AbstractSessionPartView(
    header: JComponent,
    private val makeBody: () -> JComponent,
    expanded: Boolean = false,
    private val expandable: Boolean = true,
) : PartView() {

    constructor(
        header: JComponent,
        body: JComponent,
        expanded: Boolean = false,
        expandable: Boolean = true,
    ) : this(header, { body }, expanded, expandable)

    protected val arrow = JBLabel()
    protected val row = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0))
    private val bound = linkedSetOf<Component>()
    private var body: JComponent? = null

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (!arrow.isVisible) return
            toggle()
        }
    }
    private val mouse = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
            setHover(true)
        }

        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHover(false)
        }
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        row.add(header, BorderLayout.CENTER)
        row.add(arrow, BorderLayout.EAST)
        add(row, BorderLayout.NORTH)
        bindHeader(row, header, arrow)
        if (expanded && expandable) add(body(), BorderLayout.CENTER)
        if (!expandable) syncExpandable(false) else syncArrow()
    }

    fun isExpanded(): Boolean = body?.parent === this

    fun toggle() {
        if (!expandable || !arrow.isVisible) return
        val changed = if (isExpanded()) collapse() else expand()
        if (!changed) return
        syncArrow()
        refresh()
    }

    open fun expand(): Boolean {
        if (!expandable) return false
        if (isExpanded()) return false
        add(body(), BorderLayout.CENTER)
        return true
    }

    fun collapse(): Boolean {
        val item = body ?: return false
        if (item.parent !== this) return false
        remove(item)
        return true
    }

    protected fun hasBody(): Boolean = body != null

    protected fun bodyComponent(): JComponent = body()

    fun syncExpandable(expandable: Boolean): Boolean {
        val active = this.expandable && expandable
        val changed = setVisible(arrow, active)
        val detached = if (active) false else collapse()
        val cursor = if (active) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        val moved = syncCursor(cursor)
        val icon = syncArrow()
        return changed || detached || moved || icon
    }

    protected fun bindHeader(vararg items: Component) {
        items.forEach { bind(it) }
    }

    protected fun refresh() {
        revalidate()
        repaint()
    }

    protected open fun hoverColor(value: Boolean): Color? = null

    protected open fun applyHover(value: Boolean, color: Color) {}

    private fun setHover(value: Boolean) {
        val color = hoverColor(value) ?: return
        if (row.background?.rgb == color.rgb) return
        row.background = color
        applyHover(value, color)
        row.repaint()
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, row)
        return row.contains(point)
    }

    private fun bind(component: Component) {
        if (bound.contains(component)) return
        bound.add(component)
        component.addMouseListener(click)
        component.addMouseListener(mouse)
    }

    private fun body(): JComponent {
        val item = body
        if (item != null) return item
        return makeBody().also { body = it }
    }

    private fun syncCursor(cursor: Cursor): Boolean {
        var changed = false
        bound.forEach {
            if (it.cursor?.type != cursor.type) {
                it.cursor = cursor
                changed = true
            }
        }
        return changed
    }

    private fun syncArrow(): Boolean {
        val icon = if (isExpanded()) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        if (arrow.icon === icon) return false
        arrow.icon = icon
        return true
    }

    private fun setVisible(component: JComponent, visible: Boolean): Boolean {
        if (component.isVisible == visible) return false
        component.isVisible = visible
        return true
    }
}
