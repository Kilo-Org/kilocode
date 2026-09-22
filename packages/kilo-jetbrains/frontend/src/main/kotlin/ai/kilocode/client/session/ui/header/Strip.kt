package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/**
 * Shared chrome for a collapsible, one-line-when-collapsed status strip in the session header: an
 * arrow, an optional leading [glyph], a summary [label], optional trailing [actions], and a
 * lazily-created expanded body. [TodoStrip] and [BackgroundAgentStrip] both render an identical
 * collapsed row and expand/collapse control, so the header shows one consistent chrome for either
 * kind of strip — see `packages/kilo-vscode/docs/features/background-agent-visibility.md`'s "same
 * slot as the to-do strip" precedent.
 *
 * Retained mode like the rest of the session UI: [expanded] is derived from containment (the body's
 * parent), never a separate boolean, and [createBody] runs at most once per instance.
 *
 * Non-opaque throughout: strips sit inside [SessionHeaderPanel], whose own background is the single
 * opaque surface for the header, per this plugin's session-background strategy.
 */
abstract class Strip : JPanel(), SessionEditorStyleTarget {

    protected val arrow = JBLabel(AllIcons.General.ArrowRight)
    protected val glyph = JBLabel().apply { isVisible = false }
    protected val label = JBLabel()
    protected val actions: Stack = Stack.horizontal(UiStyle.Gap.sm())
    private val content = Stack.horizontal(UiStyle.Gap.sm()).apply {
        next(glyph)
        next(label)
    }
    protected val fallback = content.align(HAlign.LEFT, VAlign.CENTER)

    /** Flexible summary slot that toggles expand/collapse; [actions] deliberately does not. */
    protected val summary = BorderLayoutPanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        add(fallback, BorderLayout.WEST)
    }
    private val row = BorderLayoutPanel().apply {
        isOpaque = false
        add(arrow, BorderLayout.WEST)
        add(summary.align(HAlign.TRACK, VAlign.CENTER), BorderLayout.CENTER)
        add(actions.align(HAlign.RIGHT, VAlign.CENTER), BorderLayout.EAST)
    }
    private var body: JComponent? = null
    private val click = object : MouseAdapter() {
        override fun mouseClicked(event: MouseEvent) = toggle()
    }

    /** Todo bodies remain horizontal; background-agent rows opt into width-tracking vertical scroll. */
    protected open val vertical = false

    /** Current style snapshot, kept for subclasses that recompute a color outside [applyStyle] (e.g. on [update]). */
    protected var style: SessionEditorStyle = SessionEditorStyle.current()
        private set

    init {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        add(row)
        // A strip has nothing to show until its owner reports content, so it starts hidden and each
        // subclass's update() turns it on via syncVisible.
        isVisible = false
        // `row` spans the full width, so the empty space beside the summary toggles too. The arrow,
        // glyph, and label keep their own listeners so a click lands on them directly; Swing
        // delivers a click only to the innermost listener, so this cannot toggle twice. Controls in
        // [actions] own their listeners and are therefore never retargeted here.
        listOf(row, summary, arrow, fallback, content, glyph, label).forEach(::watch)
    }

    /** Give a subclass-owned summary surface the strip's ordinary toggle behavior. */
    protected fun watch(component: Component) {
        component.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        component.addMouseListener(click)
    }

    /** Build the expanded body. Called at most once; the result is retained for the strip's lifetime. */
    protected abstract fun createBody(): JComponent

    /** Whether the body is currently attached — containment-derived, never a separate boolean. */
    fun expanded(): Boolean = body?.parent === this

    @RequiresEdt
    protected fun toggle() {
        if (expanded()) collapse() else expand()
        refresh()
    }

    @RequiresEdt
    protected fun expand(): Boolean {
        if (expanded()) return false
        val content = body ?: Scroller(createBody(), vertical).also { body = it }
        add(content)
        arrow.icon = AllIcons.General.ArrowDown
        return true
    }

    @RequiresEdt
    protected fun collapse(): Boolean {
        val content = body
        if (content == null || content.parent !== this) {
            arrow.icon = AllIcons.General.ArrowRight
            return false
        }
        remove(content)
        arrow.icon = AllIcons.General.ArrowRight
        return true
    }

    /** Hide the whole strip and collapse its body. Every subclass calls this when it has nothing to show. */
    @RequiresEdt
    protected fun syncVisible(visible: Boolean): Boolean {
        if (!visible) collapse()
        if (isVisible == visible) return false
        isVisible = visible
        return true
    }

    protected fun refresh() {
        revalidate()
        repaint()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        label.font = style.smallFont
        label.foreground = style.editorForeground
        arrow.foreground = style.editorForeground
        glyph.foreground = style.editorForeground
    }

    // ------ test accessors ------

    internal fun rowPanel(): JComponent = summary
    internal fun rowComponent(): JComponent = row
    internal fun labelComponent(): JComponent = label
    internal fun arrowIcon() = arrow.icon
    internal fun labelText(): String = label.text
    internal fun labelForeground() = label.foreground
    internal fun bodyAttached(): Boolean = expanded()
    internal fun bodyComponent(): JComponent? = body
}

/**
 * Scroll host for a strip body. Todo strips use the horizontal default, so a long to-do line stays
 * reachable instead of being clipped by the tool window width. Background-agent rows opt into
 * [vertical] scrolling instead: the body tracks the viewport width (see
 * `BackgroundAgentStrip.Body`), and the vertical bar caps how many rows show before scrolling so the
 * trailing action button never leaves the viewport.
 *
 * In horizontal mode the overlapping scrollbar floats over the content rather than taking its own
 * row, so an expanded strip's height never jumps when the bar appears. Preferred width is reported as
 * zero — the wide content must not widen the header, and the strip's `BoxLayout.Y_AXIS` parent
 * stretches the pane to the available width via the unbounded maximum. This is the same sizing shape
 * `MdViewHybrid.sizeCodePane` uses for scrollable code blocks.
 *
 * In vertical mode the scrollbar takes its own column (not overlapping, so it cannot cover the action
 * button) and height is left to the viewport's actual preferred/maximum size instead of being pinned.
 */
private class Scroller(view: JComponent, private val vertical: Boolean) : JBScrollPane(view) {
    init {
        border = JBUI.Borders.empty()
        viewportBorder = JBUI.Borders.empty()
        isOpaque = false
        viewport.isOpaque = false
        horizontalScrollBarPolicy = if (vertical) {
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        } else {
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        }
        verticalScrollBarPolicy = if (vertical) {
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        } else {
            ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
        }
        setOverlappingScrollBar(!vertical)
        if (!vertical) verticalScrollBar.preferredSize = JBUI.emptySize()
    }

    // Width is always supplied by the strip's parent, never by an unclipped title inside the
    // viewport. In vertical mode `BackgroundAgentStrip.Body` tracks that viewport width; its
    // scrollable preferred size only decides the capped five-row height.
    override fun getPreferredSize() = Dimension(0, super.getPreferredSize().height)

    override fun getMinimumSize() = Dimension(0, preferredSize.height)

    override fun getMaximumSize() = Dimension(Int.MAX_VALUE, preferredSize.height)
}
