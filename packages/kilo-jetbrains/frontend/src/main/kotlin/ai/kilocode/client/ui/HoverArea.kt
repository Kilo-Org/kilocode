package ai.kilocode.client.ui

import com.intellij.openapi.util.text.StringUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.ActionEvent
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.accessibility.AccessibleAction
import javax.accessibility.AccessibleContext
import javax.accessibility.AccessibleRole
import javax.swing.AbstractAction
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.SwingUtilities

/**
 * Wraps one component in the standard action hover treatment: the rounded
 * [UiStyle.Colors.actionHoverBackground] pill while hovered or focused, the hand cursor, Enter/Space
 * activation, and a push-button accessible role.
 *
 * This is the same treatment [ChangesPanel] gives its counter groups and [HoverIcon] gives a bare icon
 * button, for content that is neither — a plain label, a glyph with a count, a styled title. Without it,
 * a header whose every element opens something in the browser reads as clickable only where a real button
 * happens to sit, and the rest looks like static text that happens to move the cursor.
 *
 * Sizes to its content and floors its height at the look-and-feel's button minimum, so an area sitting in
 * a row of buttons lines up with them instead of reading as a shorter strip. A host that stretches it — a
 * `BorderLayout.CENTER` slot, a vertical [ai.kilocode.client.ui.layout.Stack] — has to wrap it in an
 * [ai.kilocode.client.ui.layout.align] of its own, or the pill spans the whole slot instead of hugging the
 * content.
 */
internal class HoverArea @RequiresEdt constructor(val content: Component) : JPanel(BorderLayout()) {
    private var over = false

    /** Null leaves the area inert: no pill, no hand cursor, and no focus stop for the keyboard. */
    var action: (() -> Unit)? = null
        set(value) {
            field = value
            sync()
        }

    private val listener = object : MouseAdapter() {
        @RequiresEdt
        override fun mouseEntered(event: MouseEvent) = hover(live())

        @RequiresEdt
        override fun mouseExited(event: MouseEvent) {
            // The listener is on the whole subtree, so leaving a child for its parent is not leaving
            // the area — only a point outside these bounds is.
            hover(live() && contains(SwingUtilities.convertPoint(event.component, event.point, this@HoverArea)))
        }

        @RequiresEdt
        override fun mouseClicked(event: MouseEvent) {
            if (event.isConsumed || event.isPopupTrigger || !SwingUtilities.isLeftMouseButton(event)) return
            if (event.clickCount != 1) return
            if (activate()) event.consume()
        }
    }

    private val activation = object : AbstractAction() {
        @RequiresEdt
        override fun actionPerformed(event: ActionEvent) {
            activate()
        }
    }

    init {
        isOpaque = false
        add(content, BorderLayout.CENTER)
        visit(this) {
            it.isFocusable = false
            it.addMouseListener(listener)
        }
        getInputMap(WHEN_FOCUSED).apply {
            put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), ACTIVATE)
            put(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0), ACTIVATE)
        }
        actionMap.put(ACTIVATE, activation)
        addFocusListener(object : FocusAdapter() {
            @RequiresEdt
            override fun focusGained(event: FocusEvent) = repaint()

            @RequiresEdt
            override fun focusLost(event: FocusEvent) = repaint()
        })
        addPropertyChangeListener("enabled") { sync() }
        sync()
    }

    /**
     * The hover tooltip, mirrored onto the content so the whole pill answers rather than only its text.
     *
     * [name] is what a screen reader announces, defaulting to the tooltip. Pass the visible text instead
     * wherever the tooltip is only a click hint: the area is the push button now rather than the label
     * inside it, so announcing "Click to open" alone would lose what is being opened.
     */
    @RequiresEdt
    fun tooltip(text: String?, name: String? = text) {
        val tip = text?.takeIf { it.isNotBlank() }
        visit(this) { if (it is JComponent && it.toolTipText != tip) it.toolTipText = tip }
        val label = name?.takeIf { it.isNotBlank() }?.let { StringUtil.stripHtml(it, " ") }
        if (getAccessibleContext().accessibleName != label) getAccessibleContext().accessibleName = label
    }

    @RequiresEdt
    override fun updateUI() {
        super.updateUI()
        // Re-derived here rather than assigned once: an assigned border captures its pixel width, and an
        // IDE zoom moves the user scale without touching content.
        border = JBUI.Borders.empty(0, UiStyle.Gap.SM)
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension = super.getPreferredSize().apply {
        height = maxOf(height, JBUI.CurrentTheme.Button.minimumSize().height)
    }

    @RequiresEdt
    private fun sync() {
        val live = live()
        if (isFocusable != live) isFocusable = live
        if (activation.isEnabled != live) activation.isEnabled = live
        val next = if (live) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        visit(this) { if (it.cursor != next) it.cursor = next }
        if (!live) hover(false)
    }

    @RequiresEdt
    private fun live(): Boolean = action != null && isEnabled && isVisible

    @RequiresEdt
    private fun activate(): Boolean {
        if (!live() || generateSequence(parent) { it.parent }.any { !it.isEnabled || !it.isVisible }) return false
        action?.invoke() ?: return false
        return true
    }

    @RequiresEdt
    private fun hover(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }

    @RequiresEdt
    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        if (!live() || (!over && !hasFocus())) return
        val canvas = g.create() as Graphics2D
        try {
            canvas.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            canvas.color = UiStyle.Colors.actionHoverBackground()
            val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
            canvas.fillRoundRect(0, 0, width, height, arc, arc)
        } finally {
            canvas.dispose()
        }
    }

    @RequiresEdt
    override fun getAccessibleContext(): AccessibleContext {
        if (accessibleContext == null) {
            accessibleContext = object : AccessibleJPanel(), AccessibleAction {
                override fun getAccessibleRole(): AccessibleRole = AccessibleRole.PUSH_BUTTON
                override fun getAccessibleAction(): AccessibleAction = this

                @RequiresEdt
                override fun getAccessibleActionCount(): Int = if (live()) 1 else 0

                @RequiresEdt
                override fun getAccessibleActionDescription(index: Int): String? =
                    if (index == 0) accessibleName else null

                @RequiresEdt
                override fun doAccessibleAction(index: Int): Boolean = index == 0 && activate()
            }
        }
        return accessibleContext
    }

    @RequiresEdt
    private fun visit(component: Component, block: (Component) -> Unit) {
        block(component)
        if (component is Container) component.components.forEach { visit(it, block) }
    }

    private companion object {
        const val ACTIVATE = "kilo.hover.activate"
    }
}
