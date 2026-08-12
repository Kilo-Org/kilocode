package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import com.intellij.ui.components.JBLabel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.event.ContainerAdapter
import java.awt.event.ContainerEvent
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
    protected val row = Row()
    private val clickable = linkedSetOf<Component>()
    private val watched = linkedSetOf<Component>()
    private var body: JComponent? = null

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (!arrow.isVisible) return
            toggle()
        }
    }
    // Hover is tracked across the whole header subtree so leaving the row via any nested
    // element (e.g. an unbound file link) still clears the hover fill. Swing only delivers
    // mouseExited to the deepest component, so a single listener on the row is not enough.
    private val pointer = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
            setHovered(true)
        }

        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHovered(false)
        }
    }
    private val nested = object : ContainerAdapter() {
        override fun componentAdded(e: ContainerEvent) = watch(e.child)
        override fun componentRemoved(e: ContainerEvent) = unwatch(e.child)
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        row.add(header, BorderLayout.CENTER)
        row.add(arrow, BorderLayout.EAST)
        add(row, BorderLayout.NORTH)
        watch(row)
        if (expanded && expandable) add(body(), BorderLayout.CENTER)
        if (!expandable) syncExpandable(false) else syncArrow()
    }

    fun isExpanded(): Boolean = body?.parent === this

    fun toggle() {
        if (!expandable || !arrow.isVisible) return
        val changed = toggleLocal()
        if (!changed) return
        userToggled()
        syncArrow()
        refresh()
    }

    protected open fun userToggled() {}

    open fun expand(): Boolean {
        if (!expandable) return false
        if (isExpanded()) return false
        add(body(), BorderLayout.CENTER)
        return true
    }

    open fun collapse(): Boolean {
        val item = body ?: return false
        if (item.parent !== this) return false
        remove(item)
        return true
    }

    protected fun hasBody(): Boolean = body != null

    protected fun bodyComponent(): JComponent = body()

    /** Detaches and forgets the cached body so the next expansion builds a fresh one. */
    protected fun discardBody(): Boolean {
        val item = body ?: return false
        val attached = item.parent === this
        if (attached) remove(item)
        body = null
        return attached
    }

    private fun toggleLocal(): Boolean {
        val fn = resize ?: return toggleBody()
        val expanded = isExpanded()
        fn(this) { toggleBody() }
        return expanded != isExpanded()
    }

    private fun toggleBody(): Boolean = if (isExpanded()) collapse() else expand()

    fun syncExpandable(expandable: Boolean): Boolean {
        val active = this.expandable && expandable
        val changed = setVisible(arrow, active)
        val detached = if (active) false else collapse()
        val cursor = if (active) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        val moved = syncCursor(cursor)
        val icon = syncArrow()
        return changed || detached || moved || icon
    }

    protected fun refresh() {
        revalidate()
        repaint()
    }

    protected open fun hoverColor(value: Boolean): Color? = null

    override fun setHovered(value: Boolean) {
        hover?.invoke(this, value)
        val old = row.background
        row.isHovered = value
        val color = row.background
        if (old.rgb == color.rgb) return
        row.repaint()
    }

    protected inner class Row : JPanel(BorderLayout(SessionUiStyle.View.Header.gap(), 0)) {
        var isHovered = false

        override fun isOpaque(): Boolean {
            return hoverColor(false) != null
        }

        override fun getBackground(): Color {
            return hoverColor(isHovered) ?: super.getBackground()
        }
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, row)
        return row.contains(point)
    }

    /**
     * Attaches hover (and, for non-interactive elements, click-to-toggle) to [component] and its
     * whole subtree, keeping up with later children. Hover covers everything so leaving the row via
     * any nested element clears the fill. Click-to-toggle is bound only where the element does not
     * already own a mouse listener, so controls like file links and copy buttons keep their own
     * click action and do not also toggle the card. This means a control must install its own mouse
     * listener before it joins the header subtree: a control that adds its listener later would
     * already carry the toggle listener and would both act and toggle. All current call sites bind
     * their listeners in constructors, so this ordering holds.
     */
    private fun watch(component: Component) {
        if (!watched.add(component)) return
        if (component.mouseListeners.isEmpty()) {
            component.addMouseListener(click)
            clickable.add(component)
            // Toggle-clickable header elements show the hand cursor while the card is toggleable.
            // Arrow visibility mirrors that state, and syncExpandable resets the cursor when it flips.
            if (arrow.isVisible) component.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }
        component.addMouseListener(pointer)
        if (component is Container) {
            component.addContainerListener(nested)
            component.components.forEach { watch(it) }
        }
    }

    private fun unwatch(component: Component) {
        if (!watched.remove(component)) return
        if (clickable.remove(component)) {
            component.removeMouseListener(click)
            component.cursor = Cursor.getDefaultCursor()
        }
        component.removeMouseListener(pointer)
        if (component is Container) {
            component.removeContainerListener(nested)
            component.components.forEach { unwatch(it) }
        }
    }

    private fun body(): JComponent {
        val item = body
        if (item != null) return item
        return makeBody().also { body = it }
    }

    private fun syncCursor(cursor: Cursor): Boolean {
        var changed = false
        clickable.forEach {
            if (it.cursor?.type != cursor.type) {
                it.cursor = cursor
                changed = true
            }
        }
        return changed
    }

    private fun syncArrow(): Boolean {
        val icon = if (isExpanded()) SessionViewIcons.chevronExpanded else SessionViewIcons.chevronCollapsed
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
