package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.BranchChangesBadge
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.hoverTextButton
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.ProductIcons
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import org.jetbrains.plugins.terminal.TerminalIcons
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

internal class WorktreePrHeaderView(
    openWorktree: () -> Unit = {},
    openEnabled: Boolean = true,
    openTerminal: () -> Unit = {},
    openDiff: () -> Unit,
) : BorderLayoutPanel() {
    private val terminal = hoverTextButton(
        ToolbarButtonAction(TerminalIcons.OpenTerminal_13x13, KiloBundle.message("worktree.session.terminal.action"), openTerminal),
        tooltip = KiloBundle.message("worktree.session.terminal.tooltip"),
    )
    private val open = hoverTextButton(
        ToolbarButtonAction(ProductIcons.getInstance().productIcon, KiloBundle.message("worktree.session.open.action"), openWorktree),
        tooltip = KiloBundle.message("worktree.session.open.tooltip"),
    )
    private val status = JBLabel()
    private val title = SimpleColoredComponent()
    private val changes = BranchChangesBadge(openDiff).apply { applyStyle(SessionEditorStyle.current()) }
    private val statusPane = status.align(HAlign.LEFT, VAlign.CENTER)
    private val actions = Stack.horizontal(UiStyle.Gap.sm())
        .next(changes.align(HAlign.CENTER, VAlign.CENTER))
        .next(terminal.align(HAlign.CENTER, VAlign.CENTER))
        .next(open.align(HAlign.CENTER, VAlign.CENTER))
    private var pull: WorktreePrDto? = null
    private var state: GhState? = null
    private var text: String? = null
    private var tip: String? = null
    private var url: String? = null

    init {
        isOpaque = false
        actions.isOpaque = false
        open.isEnabled = openEnabled
        terminal.isEnabled = openEnabled
        actions.border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
        status.border = JBUI.Borders.empty(0, UiStyle.Gap.md(), 0, UiStyle.Gap.xs())
        title.border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        title.isOpaque = false
        addToLeft(statusPane)
        addToCenter(title)
        addToRight(actions.align(HAlign.RIGHT, VAlign.CENTER))
        val listener = object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                url?.let(BrowserUtil::browse)
            }
        }
        status.addMouseListener(listener)
        title.addMouseListener(listener)
        syncClick(null)
    }

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String) {
        changes.update(stats?.files ?: 0, stats?.additions ?: 0, stats?.deletions ?: 0)
        this.pull = pull
        if (pull == null) {
            syncPr(false)
            syncStatus(null)
            clearTitle()
            syncClick(null)
            return
        }
        syncPr(true)
        val title = pull.title.trim()
        val text = if (title.isBlank()) null else title
        val tip = prTooltip(pull, name.takeIf { it.isNotBlank() && it != pull.title.trim() })
        syncStatus(pull.state)
        syncTitle("#${pull.number}", text, tip)
        syncClick(pull.url)
        status.toolTipText = tip
    }

    private fun syncStatus(next: GhState?) {
        if (state == next) {
            val visible = next != null
            if (status.isVisible != visible) status.isVisible = visible
            return
        }
        state = next
        status.icon = next?.let { FilledBadgeIcon(stateLabel(it), style(it)) }
        status.isVisible = next != null
        changed()
    }

    private fun syncPr(value: Boolean) {
        if (value) {
            if (title.parent !== this) add(title, BorderLayout.CENTER)
            title.isVisible = true
            return
        }
        title.isVisible = false
        changed()
    }

    private fun clearTitle() {
        if (text == null && tip == null) return
        text = null
        tip = null
        title.clear()
        title.toolTipText = null
        status.toolTipText = null
        changed()
    }

    private fun syncTitle(prefix: String, next: String?, nextTip: String?) {
        val full = listOfNotNull(prefix, next).joinToString(" ")
        var changed = false
        if (text != full) {
            text = full
            title.clear()
            if (next == null) {
                title.append(prefix, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, UIUtil.getLabelForeground()))
            } else {
                title.append("$prefix ", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                title.append(next, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, UIUtil.getLabelForeground()))
            }
            changed = true
        }
        if (tip != nextTip) {
            tip = nextTip
            title.toolTipText = nextTip
            if (pull == null) status.toolTipText = null
            changed = true
        }
        if (changed) changed()
    }

    private fun syncClick(next: String?) {
        if (url == next) return
        url = next
        val cursor = if (next != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        status.cursor = cursor
        title.cursor = cursor
    }

    private fun changed() {
        revalidate()
        repaint()
    }
}
