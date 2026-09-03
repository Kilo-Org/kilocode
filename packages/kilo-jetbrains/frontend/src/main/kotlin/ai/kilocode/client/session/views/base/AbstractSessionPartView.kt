package ai.kilocode.client.session.views.base

import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.ContainerAdapter
import java.awt.event.ContainerEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

/**
 * Base for every collapsible session card. A card is a header [row] plus an optional lazily built
 * body. Collapsed, the card is just the header with a rounded hover fill. Expanded, the body is
 * attached under the header and separated from it by a transparent [SessionUiStyle.View.contentGap]
 * (the BorderLayout vgap) — the card draws no outline and no separator line, so content reads as
 * standalone raised surfaces on the shared session backdrop.
 */
abstract class AbstractSessionPartView(
    header: JComponent,
    private val makeBody: () -> JComponent,
    private val makeFooter: (() -> JComponent)? = null,
    expanded: Boolean = false,
    private val expandable: Boolean = true,
    private val compact: Boolean = false,
) : PartView() {

    constructor(
        header: JComponent,
        body: JComponent,
        expanded: Boolean = false,
        expandable: Boolean = true,
        compact: Boolean = false,
    ) : this(header, { body }, null, expanded, expandable, compact)

    protected val arrow = JBLabel()
    protected val row = Row()
    private val clickable = linkedSetOf<Component>()
    private val watched = linkedSetOf<Component>()
    private var body: JComponent? = null
    private var footer: JComponent? = null

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
        // The vgap becomes the transparent inset between the header and the body once a body is
        // attached; collapsed cards have only the NORTH row, so no gap shows.
        layout = BorderLayout(0, SessionUiStyle.View.contentGap())
        isOpaque = false
        val pad = JBUI.scale(
            if (compact) SessionUiStyle.View.Layout.COMPACT_VERTICAL_PADDING
            else SessionUiStyle.View.Layout.VERTICAL_PADDING,
        )
        row.border = JBUI.Borders.empty(pad, SessionUiStyle.View.Header.left(), pad, SessionUiStyle.View.Header.right())
        row.add(header, BorderLayout.CENTER)
        row.add(arrow, BorderLayout.EAST)
        add(row, BorderLayout.NORTH)
        watch(row)
        if (expanded && expandable) attachBody()
        if (!expandable) syncExpandable(false) else syncArrow()
    }

    /**
     * The transparent header-to-content inset once expanded, else 0. Subclasses that cap their
     * preferred height (`row.height + bodyHeight`) add this so the separator inset is accounted for.
     */
    protected fun expandedGap(): Int = if (isExpanded()) SessionUiStyle.View.contentGap() else 0

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
        attachBody()
        return true
    }

    open fun collapse(): Boolean {
        val item = body ?: return false
        if (item.parent !== this) return false
        remove(item)
        footer?.takeIf { it.parent === this }?.let(::remove)
        return true
    }

    protected fun hasBody(): Boolean = body != null

    protected fun bodyComponent(): JComponent = body()

    /** Detaches and forgets the cached body so the next expansion builds a fresh one. */
    protected fun discardBody(): Boolean {
        val item = body ?: return false
        val attached = item.parent === this
        if (attached) remove(item)
        footer?.takeIf { it.parent === this }?.let(::remove)
        body = null
        footer = null
        return attached
    }

    protected fun footerHeight(): Int {
        val item = footer ?: return 0
        if (!item.isVisible) return 0
        return expandedGap() + item.preferredSize.height
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

    /**
     * Standard collapsed hover-preview request anchored to the card header, or null when the card is
     * not expandable, is already expanded, or has no [present] preview content. [kind]/[name] are the
     * telemetry attributes (e.g. `"tool"`/`"bash"`, `"part"`/`"reasoning"`). [body] is built lazily
     * when the popup actually shows; its disposable is owned by the popup controller and disposed on
     * hide, so subclasses just build fresh, self-contained content.
     */
    @RequiresEdt
    protected fun popup(kind: String, name: String, present: Boolean, body: () -> HeaderPopupBody): HeaderPopupRequest? {
        if (!expandable || isExpanded() || !present) return null
        return HeaderPopupRequest(row, body) {
            Telemetry.send("Header Popup Shown", mapOf("surface" to "session", kind to name))
        }
    }

    /**
     * Builds a markdown-backed [HeaderPopupBody] from [markdown]. The created [MdView] is owned by a
     * fresh disposable that the popup controller disposes when the popup hides, so its editor is always
     * released. [options] renders through an editor-only code block (shell/diff style); null renders
     * prose. Height is bounded centrally by the popup panel to the same cap every popup shares; width
     * uses the wide or normal popup cap.
     */
    @RequiresEdt
    protected fun markdownPopupBody(
        style: SessionEditorStyle,
        markdown: String,
        wide: Boolean = true,
        options: MdCodeBlockOptions? = null,
        font: Font = style.editorFont,
        foreground: Color = style.editorForeground,
        link: ((String) -> Unit)? = null,
        afterSet: (MdView) -> Unit = {},
    ): HeaderPopupBody {
        val owner = Disposer.newDisposable("Header popup body")
        val md = if (options != null) {
            MdViewFactory.create(style, null, MdCodeBlockFactory.default(options))
        } else {
            MdViewFactory.create(style, null)
        }
        Disposer.register(owner, md)
        link?.let { l -> md.addLinkListener { l(it.href) } }
        md.applyStyle(style)
        md.font = font
        md.foreground = foreground
        md.background = SessionUiStyle.Colors.codeBlockBackground()
        md.preBg = SessionUiStyle.Colors.codeBlockBackground()
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        md.set(markdown)
        afterSet(md)
        val width = if (wide) SessionUiStyle.View.Popup.WIDE_MAX_WIDTH else SessionUiStyle.View.Popup.MAX_WIDTH
        return HeaderPopupBody(md.component, owner, SessionUiStyle.Colors.codeBlockBackground(), width)
    }

    /**
     * Builds a popup body around an already-created Swing [component]. The disposable owner is still
     * routed through the same popup-controller lifecycle as markdown popups, so the content subtree is
     * released when the popup hides even when the component itself has no disposable resources today.
     */
    @RequiresEdt
    protected fun componentPopupBody(
        component: JComponent,
        background: Color = SessionUiStyle.Colors.codeBlockBackground(),
        wide: Boolean = true,
    ): HeaderPopupBody {
        val owner = Disposer.newDisposable("Header popup body")
        if (component is Disposable) Disposer.register(owner, component)
        val width = if (wide) SessionUiStyle.View.Popup.WIDE_MAX_WIDTH else SessionUiStyle.View.Popup.MAX_WIDTH
        return HeaderPopupBody(component, owner, background, width)
    }

    /**
     * Header background, hovered or not. The header keeps the same rounded fill whether the card is
     * collapsed or expanded — only the arrow toggles — because the card no longer draws an outline
     * for the expanded body to meet.
     */
    protected open fun hoverColor(value: Boolean): Color =
        if (value) SessionUiStyle.View.Surface.headerHoverBgColor() else SessionUiStyle.View.Surface.headerBgColor()

    /** Corner arc (scaled) for the header hover fill. */
    protected open fun hoverArc(): Int = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)

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

        // Painted by paintComponent so the hover fill can be rounded; a rounded opaque fill would
        // leave the corners stale, so the row stays non-opaque and the backdrop shows through.
        override fun isOpaque(): Boolean = false

        override fun getBackground(): Color {
            return hoverColor(isHovered)
        }

        override fun paintComponent(g: Graphics) {
            super.paintComponent(g)
            val color = hoverColor(isHovered)
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.color = color
                val arc = hoverArc()
                if (arc > 0) g2.fillRoundRect(0, 0, width, height, arc, arc) else g2.fillRect(0, 0, width, height)
            } finally {
                g2.dispose()
            }
        }
    }

    /**
     * Whether the pointer is still on the row. Bounds alone are not enough: an overlay painted above
     * the transcript (the connection banner, the modal blocker) owns the pointer while sitting inside
     * the row's rectangle, and Swing stops delivering to the row without ever leaving it
     * geometrically. Asking which component is topmost at that point treats a covered row as left, so
     * the exit clears the hover instead of keeping the row lit — and its popup alive — under the
     * overlay.
     */
    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, row)
        if (!row.contains(point)) return false
        val pane = SwingUtilities.getRootPane(row)?.layeredPane ?: return true
        val spot = SwingUtilities.convertPoint(e.component, e.point, pane)
        val top = SwingUtilities.getDeepestComponentAt(pane, spot.x, spot.y) ?: return true
        return SwingUtilities.isDescendingFrom(top, row)
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

    private fun attachBody() {
        add(body(), BorderLayout.CENTER)
        val item = footer()
        if (item != null) add(item, BorderLayout.SOUTH)
    }

    private fun footer(): JComponent? {
        val item = footer
        if (item != null) return item
        val make = makeFooter ?: return null
        return make().also { footer = it }
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
