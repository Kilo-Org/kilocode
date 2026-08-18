package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.ui.components.JBLabel
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
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke

internal class BranchChangesBadge(
    private val open: () -> Unit,
) : JPanel(null) {
    private val count = JBLabel()
    private val stat = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT)
    private val row = Stack.horizontal(gap = UiStyle.Gap.sm()).next(count).next(stat)
    private var files = 0
    private var additions = 0
    private var deletions = 0
    private var over = false

    init {
        isOpaque = false
        isVisible = false
        isFocusable = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("diff.editor.branch.tooltip")
        getAccessibleContext().accessibleName = KiloBundle.message("diff.editor.branch.tooltip")
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        add(row)
        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(event: MouseEvent) = hover(true)
            override fun mouseExited(event: MouseEvent) = hover(false)
            override fun mouseClicked(event: MouseEvent) = activate()
        })
        // Keep the action reachable without a mouse (the HoverIcon this replaced was an
        // AbstractButton). Enter/Space fire the same guarded action as a click.
        val action = object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) = activate()
        }
        getInputMap(JComponent.WHEN_FOCUSED).apply {
            put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), ACTIVATE)
            put(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0), ACTIVATE)
        }
        actionMap.put(ACTIVATE, action)
    }

    private fun activate() {
        if (isEnabled) open()
    }

    fun applyStyle(style: SessionEditorStyle) {
        count.font = style.smallFont
        count.foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    override fun getPreferredSize(): Dimension {
        val ins = insets
        val size = row.preferredSize
        return Dimension(size.width + ins.left + ins.right, JBUI.scale(24))
    }

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, preferredSize.height)

    override fun doLayout() {
        val ins = insets
        val w = maxOf(0, width - ins.left - ins.right)
        val h = maxOf(0, height - ins.top - ins.bottom)
        val size = row.preferredSize
        val rowW = minOf(size.width, w)
        val rowH = minOf(size.height, h)
        row.setBounds(ins.left, ins.top + (h - rowH) / 2, rowW, rowH)
    }

    fun update(next: List<DiffFileDto>): Boolean =
        set(next.size, next.sumOf { it.additions }, next.sumOf { it.deletions })

    /** Update from precomputed aggregates (e.g. worktree branch stats without a per-file list). */
    fun update(files: Int, additions: Int, deletions: Int): Boolean =
        set(files, additions, deletions)

    private fun set(n: Int, add: Int, del: Int): Boolean {
        if (files == n && additions == add && deletions == del) return false
        files = n
        additions = add
        deletions = del
        count.text = KiloBundle.message(
            if (n == 1) "session.changes.count.one" else "session.changes.count.other",
            n,
        )
        stat.update(add, del)
        isVisible = n > 0
        revalidate()
        repaint()
        return true
    }

    override fun paintComponent(g: Graphics) {
        if (over && isEnabled) paintHover(g)
        super.paintComponent(g)
    }

    internal fun countText() = count.text

    internal fun stats() = additions to deletions

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

    private companion object {
        const val ACTIVATE = "kilo.branch.changes.activate"
    }
}
