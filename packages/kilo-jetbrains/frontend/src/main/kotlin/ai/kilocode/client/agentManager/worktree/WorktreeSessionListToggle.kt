package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractAction
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke

/**
 * Shows/hides the worktree editor's session list. Sits left of the toolbar and, while the list is
 * hidden, carries the session count in a neutral badge — or the activity icon of a background session
 * that needs the user, so a pending question is visible with the list collapsed.
 *
 * Not a [ai.kilocode.client.ui.HoverIcon]: that hosts a single icon and pins icon-only buttons to
 * 24x24, which would clip the trailing badge. The hover treatment is reproduced here instead.
 */
internal class WorktreeSessionListToggle(
    private val onClick: () -> Unit,
) : JPanel(null) {
    private val glyph = JBLabel(LAYOUT_PARTIAL)
    private val badge = JBLabel()
    private val row = Stack.horizontal(gap = UiStyle.Gap.sm()).next(glyph).next(badge)
    private var state = State()
    private var over = false

    init {
        isOpaque = false
        isFocusable = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        badge.isVisible = false
        label(KiloBundle.message("worktree.session.list.expand"))
        add(row)
        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(event: MouseEvent) = hover(true)
            override fun mouseExited(event: MouseEvent) = hover(false)
            override fun mouseClicked(event: MouseEvent) {
                if (isEnabled) onClick()
            }
        })
        // Keep the toggle reachable without a mouse, the way the toolbar action it replaced was.
        val action = object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) {
                if (isEnabled) onClick()
            }
        }
        getInputMap(JComponent.WHEN_FOCUSED).apply {
            put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), ACTIVATE)
            put(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0), ACTIVATE)
        }
        actionMap.put(ACTIVATE, action)
    }

    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.empty(JBUI.CurrentTheme.Toolbar.toolbarButtonInsets())
    }

    @RequiresEdt
    fun update(expanded: Boolean, count: Int, kind: SessionActivityKind?) {
        val next = State(expanded, count, kind)
        if (next == state) return
        state = next
        glyph.icon = if (expanded) LAYOUT_FULL else LAYOUT_PARTIAL
        val icon = badge(next)
        badge.icon = icon
        badge.isVisible = icon != null
        label(KiloBundle.message(if (expanded) "worktree.session.list.collapse" else "worktree.session.list.expand"))
        revalidate()
        repaint()
    }

    override fun getPreferredSize(): Dimension {
        val ins = insets
        val size = row.preferredSize
        return Dimension(size.width + ins.left + ins.right, JBUI.scale(24))
    }

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = preferredSize

    override fun doLayout() {
        val ins = insets
        val w = maxOf(0, width - ins.left - ins.right)
        val h = maxOf(0, height - ins.top - ins.bottom)
        val size = row.preferredSize
        val rowW = minOf(size.width, w)
        val rowH = minOf(size.height, h)
        row.setBounds(ins.left, ins.top + (h - rowH) / 2, rowW, rowH)
    }

    override fun paintComponent(g: Graphics) {
        if (over && isEnabled) paintHover(g)
        super.paintComponent(g)
    }

    /**
     * Trailing badge while the list is hidden: a session that needs the user outranks the count, and a
     * lone session needs no count at all.
     */
    private fun badge(state: State): Icon? = when {
        state.expanded -> null
        state.kind != null -> state.kind.icon()
        state.count >= COUNT -> FilledBadgeIcon(state.count.toString(), UiStyle.Badge.Secondary)
        else -> null
    }

    private fun label(text: String) {
        toolTipText = text
        // getAccessibleContext() lazily creates the context; the field itself is still null here.
        getAccessibleContext().accessibleName = text
    }

    private fun hover(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }

    private fun paintHover(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = UiStyle.Colors.actionHoverBackground()
            val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
            g2.fillRoundRect(0, 0, width, height, arc, arc)
        } finally {
            g2.dispose()
        }
    }

    private data class State(
        val expanded: Boolean = false,
        val count: Int = 0,
        val kind: SessionActivityKind? = null,
    )

    private companion object {
        const val ACTIVATE = "kilo.worktree.sessionList.activate"

        /** A single session is the norm, so the count only earns a badge from the second one on. */
        const val COUNT = 2
        private val OWNER = WorktreeSessionListToggle::class.java
        val LAYOUT_PARTIAL: Icon = IconLoader.getIcon("/icons/layout-left-partial.svg", OWNER)
        val LAYOUT_FULL: Icon = IconLoader.getIcon("/icons/layout-left-full.svg", OWNER)
    }
}
