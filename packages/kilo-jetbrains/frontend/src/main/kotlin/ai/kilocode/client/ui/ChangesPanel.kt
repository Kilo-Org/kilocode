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
        val next = if (mode == Mode.COMPACT) {
            State(files, additions, deletions, base = base)
        } else {
            State(files, additions, deletions, ahead, behind, localFiles, localAdditions, localDeletions, base)
        }
        if (state == next) return
        state = next
        val tip = if (base.isBlank()) {
            KiloBundle.message("worktree.stats.tooltip", files, additions, deletions)
        } else {
            KiloBundle.message("worktree.stats.base.tooltip", files, additions, deletions, base)
        }
        this.base.update(files, additions, deletions, tip)
        local?.update(
            localFiles, localAdditions, localDeletions,
            KiloBundle.message("worktree.dirty.tooltip", localFiles, localAdditions, localDeletions),
        )
        this.ahead?.let { counter(it, ahead) }
        this.behind?.let { counter(it, behind) }
        val right = files > 0 || next.ahead > 0 || next.behind > 0
        separator?.let { if (it.isVisible != (localFiles > 0 && right)) it.isVisible = localFiles > 0 && right }
        val visible = right || next.localFiles > 0
        if (isVisible != visible) isVisible = visible
        val tooltip = tip.takeIf { mode == Mode.COMPACT && files > 0 }
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
    )

    private companion object {
        const val ACTIVATE = "kilo.changes.activate"
    }
}
