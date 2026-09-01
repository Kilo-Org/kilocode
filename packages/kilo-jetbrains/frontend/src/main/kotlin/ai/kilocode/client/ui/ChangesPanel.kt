package ai.kilocode.client.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.text.StringUtil
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
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
import javax.swing.JSeparator
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

internal class ChangesPanel @RequiresEdt constructor(
    private val mode: Mode,
    onBase: (() -> Unit)? = null,
    onLocal: (() -> Unit)? = null,
) : JPanel(BorderLayout()) {
    internal enum class Mode { COMPACT, FULL }

    private val base = Group(fill = true)
    private val local = if (mode == Mode.FULL) Group(fill = false) else null
    private val ahead = if (mode == Mode.FULL) counter("/icons/arrow-up.svg", "worktree.stats.ahead.tooltip") else null
    private val behind = if (mode == Mode.FULL) counter("/icons/arrow-down-to-line.svg", "worktree.stats.behind.tooltip") else null
    private val separator = if (mode == Mode.FULL) JSeparator(SwingConstants.VERTICAL) else null
    private var state: State? = null

    init {
        isOpaque = false
        isFocusable = false
        isVisible = false
        if (mode == Mode.COMPACT) {
            add(base, BorderLayout.CENTER)
            addMouseListener(base.listener)
        } else {
            add(Stack.horizontal(UiStyle.Gap.md()).next(local!!).next(separator!!).next(ahead!!).next(behind!!).next(base))
        }
        visit(this) { it.isFocusable = false }
        font = JBFont.small()
        foreground = JBColor.lazy { UiStyle.Colors.weak() }
        setActions(onBase, onLocal)
    }

    /**
     * [onBase] drives the only group a compact summary has, whichever counts it ended up showing — a
     * compact host that passes an uncommitted set has to hand over the action that matches it, because
     * this widget cannot know which comparison the counts came from.
     */
    @RequiresEdt
    fun setActions(onBase: (() -> Unit)?, onLocal: (() -> Unit)? = null) {
        base.action = onBase
        local?.action = onLocal
        syncActions()
    }

    @RequiresEdt
    fun update(
        files: Int,
        additions: Int,
        deletions: Int,
        ahead: Int = 0,
        behind: Int = 0,
        localFiles: Int = 0,
        localAdditions: Int = 0,
        localDeletions: Int = 0,
        base: String = "",
    ) {
        // A compact summary has one group, so uncommitted work is all it can show for a worktree that has
        // committed nothing yet — and hiding instead would read as "this worktree changed nothing", which
        // is the opposite of what the row is being asked. The counts it drops in that case are zero, so
        // they stay out of the state and an unrelated poll cannot repaint the row.
        val next = when {
            mode == Mode.FULL ->
                State(files, additions, deletions, ahead, behind, localFiles, localAdditions, localDeletions, base)
            files == 0 && localFiles > 0 ->
                State(localFiles, localAdditions, localDeletions, base = base, local = true)
            else -> State(files, additions, deletions, base = base)
        }
        if (state == next) return
        state = next
        // A compact summary sits inside a row that already prints the file count and the +/- lines, so
        // its tooltip only has to say what a click does. The full form is the one that can be squeezed
        // out of a narrow header, and it keeps the counts and the base branch.
        val tip = when {
            next.local -> KiloBundle.message("worktree.dirty.tooltip.open")
            mode == Mode.COMPACT -> KiloBundle.message("worktree.stats.tooltip.open")
            base.isBlank() -> KiloBundle.message("worktree.stats.tooltip", files, additions, deletions)
            else -> KiloBundle.message("worktree.stats.base.tooltip", files, additions, deletions, base)
        }
        this.base.update(next.files, next.additions, next.deletions, tip)
        local?.update(
            next.localFiles, next.localAdditions, next.localDeletions,
            KiloBundle.message("worktree.dirty.tooltip", next.localFiles, next.localAdditions, next.localDeletions),
        )
        this.ahead?.let { counter(it, next.ahead) }
        this.behind?.let { counter(it, next.behind) }
        val right = next.files > 0 || next.ahead > 0 || next.behind > 0
        val fence = next.localFiles > 0 && right
        separator?.let { if (it.isVisible != fence) it.isVisible = fence }
        val visible = right || next.localFiles > 0
        if (isVisible != visible) isVisible = visible
        val tooltip = tip.takeIf { mode == Mode.COMPACT && next.files > 0 }
        if (toolTipText != tooltip) toolTipText = tooltip
        syncActions()
        revalidate()
        repaint()
    }

    @RequiresEdt
    override fun setEnabled(enabled: Boolean) {
        if (isEnabled == enabled) return
        super.setEnabled(enabled)
        syncActions()
    }

    @RequiresEdt
    override fun setFont(font: Font?) {
        if (getFont() != font) super.setFont(font)
        visit(this) { if (it is JBLabel && it.font != font) it.font = font }
    }

    @RequiresEdt
    override fun setForeground(color: Color?) {
        if (foreground != color) super.setForeground(color)
        visit(this) {
            if (it is JBLabel && SwingUtilities.getAncestorOfClass(DiffStatBadge::class.java, it) == null && it.foreground != color) {
                it.foreground = color
            }
        }
    }

    @RequiresEdt
    private fun syncActions() {
        visit(this) { if (it is Group) it.syncAction() }
        val next = if (mode == Mode.COMPACT) base.cursor else Cursor.getDefaultCursor()
        if (cursor != next) cursor = next
    }

    @RequiresEdt
    private fun counter(path: String, key: String) = JBLabel().apply {
        icon = IconLoader.getIcon(path, ChangesPanel::class.java)
        iconTextGap = UiStyle.Gap.xs()
        foreground = JBColor.lazy { UiStyle.Colors.weak() }
        toolTipText = KiloBundle.message(key)
        isFocusable = false
        isVisible = false
    }

    @RequiresEdt
    private fun counter(label: JBLabel, value: Int) {
        val text = value.toString()
        if (label.text != text) label.text = text
        if (label.isVisible != (value > 0)) label.isVisible = value > 0
        label.accessibleContext.accessibleName = "${label.toolTipText}: $value"
    }

    @RequiresEdt
    private fun visit(component: Component, block: (Component) -> Unit) {
        block(component)
        if (component is Container) component.components.forEach { visit(it, block) }
    }

    private inner class Group @RequiresEdt constructor(fill: Boolean) : JPanel(BorderLayout()) {
        private val count = JBLabel().apply { foreground = JBColor.lazy { UiStyle.Colors.weak() } }
        private val stat = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT, fill = fill)
        private var over = false
        var action: (() -> Unit)? = null
        val listener = object : MouseAdapter() {
            @RequiresEdt
            override fun mouseEntered(event: MouseEvent) = hover(interactive())

            @RequiresEdt
            override fun mouseExited(event: MouseEvent) {
                hover(interactive() && contains(SwingUtilities.convertPoint(event.component, event.point, this@Group)))
            }

            @RequiresEdt
            override fun mouseClicked(event: MouseEvent) {
                if (event.isConsumed || event.isPopupTrigger || !SwingUtilities.isLeftMouseButton(event) || event.clickCount != 1) return
                if (activate(event.component)) event.consume()
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
            isVisible = false
            stat.isVisible = false
            add(Stack.horizontal(UiStyle.Gap.sm()).next(count).next(stat).align(HAlign.LEFT, VAlign.CENTER))
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
            addPropertyChangeListener("enabled") { syncAction() }
        }

        @RequiresEdt
        override fun updateUI() {
            super.updateUI()
            border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        }

        @RequiresEdt
        override fun getPreferredSize(): Dimension = super.getPreferredSize().apply {
            height = maxOf(height, JBUI.CurrentTheme.Button.minimumSize().height)
        }

        @RequiresEdt
        fun update(files: Int, additions: Int, deletions: Int, tip: String) {
            val text = KiloBundle.message(if (files == 1) "session.changes.count.one" else "session.changes.count.other", files)
            if (count.text != text) count.text = text
            if (count.isVisible != (files > 0)) count.isVisible = files > 0
            stat.update(additions, deletions)
            val lines = files > 0 && (additions > 0 || deletions > 0)
            if (stat.isVisible != lines) stat.isVisible = lines
            if (isVisible != (files > 0)) isVisible = files > 0
            val tooltip = tip.takeIf { files > 0 }
            visit(this) { if (it is JComponent && it.toolTipText != tooltip) it.toolTipText = tooltip }
            val name = tooltip?.let { StringUtil.stripHtml(it, " ") }
            if (getAccessibleContext().accessibleName != name) getAccessibleContext().accessibleName = name
        }

        @RequiresEdt
        fun syncAction() {
            val active = interactive()
            if (isFocusable != active) isFocusable = active
            if (activation.isEnabled != active) activation.isEnabled = active
            val cursor = if (active) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
            visit(this) { if (it.cursor != cursor) it.cursor = cursor }
            if (!active) hover(false)
        }

        @RequiresEdt
        private fun interactive(): Boolean =
            action != null && isVisible && isEnabled && this@ChangesPanel.isEnabled && this@ChangesPanel.isVisible

        @RequiresEdt
        private fun activate(source: Component = this): Boolean {
            if (!interactive() || generateSequence(source) { it.parent }.any { !it.isEnabled || !it.isVisible }) return false
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
            if (!interactive() || (!over && !hasFocus())) return
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
                    override fun getAccessibleActionCount(): Int = if (interactive()) 1 else 0

                    @RequiresEdt
                    override fun getAccessibleActionDescription(index: Int): String? = if (index == 0) accessibleName else null

                    @RequiresEdt
                    override fun doAccessibleAction(index: Int): Boolean = index == 0 && activate()
                }
            }
            return accessibleContext
        }
    }

    private data class State(
        val files: Int,
        val additions: Int,
        val deletions: Int,
        val ahead: Int = 0,
        val behind: Int = 0,
        val localFiles: Int = 0,
        val localAdditions: Int = 0,
        val localDeletions: Int = 0,
        val base: String = "",
        /** The counts above are uncommitted, stood in for a committed set that is empty. Compact only. */
        val local: Boolean = false,
    )

    private companion object {
        const val ACTIVATE = "kilo.changes.activate"
    }
}
