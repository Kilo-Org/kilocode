package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.prTooltip
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.BrowserUtil
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

/**
 * Neutral core of the branch/PR header: a state badge (LEFT), the PR title (CENTER, click opens the
 * PR in the browser), and a changes badge plus a host-fillable trailing action slot (RIGHT).
 *
 * Shared by the Agent Manager worktree editor ([ai.kilocode.client.agentManager.worktree.WorktreePrHeaderView])
 * and the chat [BranchDock]. Retained-mode: [update] mutates existing nodes rather than rebuilding.
 * Stays non-opaque so the host owns background and borders.
 */
internal class PrHeaderView(
    private val titleStyle: Int = SimpleTextAttributes.STYLE_BOLD,
    openDiff: () -> Unit,
) : BorderLayoutPanel(), SessionEditorStyleTarget {
    private val status = JBLabel()
    private val title = SimpleColoredComponent()
    private val changes = BranchChangesBadge(openDiff)
    private val statusPane = status.align(HAlign.LEFT, VAlign.CENTER)
    private val actions = Stack.horizontal(UiStyle.Gap.sm())
        .next(changes.align(HAlign.CENTER, VAlign.CENTER))
    private var style = SessionEditorStyle.current()
    private var pull: WorktreePrDto? = null
    private var state: GhState? = null
    private var number: String? = null
    private var body: String? = null
    private var tip: String? = null
    private var url: String? = null

    init {
        isOpaque = false
        actions.isOpaque = false
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
        changes.applyStyle(style)
        syncClick(null)
    }

    /** Adds a host action into the trailing slot, to the right of the changes badge. */
    fun addAction(component: Component) {
        actions.next(component.align(HAlign.CENTER, VAlign.CENTER))
    }

    /** Update from worktree branch stats (files/additions/deletions on the stats DTO). */
    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String) {
        changes.update(stats?.files ?: 0, stats?.additions ?: 0, stats?.deletions ?: 0)
        applyPr(pull, name)
    }

    /** Update from precomputed change aggregates (chat dock aggregates a DiffFileDto list). */
    @RequiresEdt
    fun update(files: Int, additions: Int, deletions: Int, pull: WorktreePrDto?, name: String) {
        changes.update(files, additions, deletions)
        applyPr(pull, name)
    }

    @RequiresEdt
    private fun applyPr(pull: WorktreePrDto?, name: String) {
        this.pull = pull
        if (pull == null) {
            syncPr(false)
            syncStatus(null)
            clearTitle()
            syncClick(null)
            return
        }
        syncPr(true)
        val trimmed = pull.title.trim()
        val body = trimmed.takeIf { it.isNotBlank() }
        val tip = prTooltip(pull, name.takeIf { it.isNotBlank() && it != trimmed })
        syncStatus(pull.state)
        syncTitle("#${pull.number}", body, tip)
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
            title.isVisible = true
            return
        }
        title.isVisible = false
        changed()
    }

    private fun clearTitle() {
        if (number == null && tip == null) return
        number = null
        body = null
        tip = null
        title.clear()
        title.toolTipText = null
        status.toolTipText = null
        changed()
    }

    private fun syncTitle(number: String, body: String?, nextTip: String?) {
        var changed = false
        if (this.number != number || this.body != body) {
            this.number = number
            this.body = body
            renderTitle()
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

    private fun renderTitle() {
        val number = number ?: return
        title.clear()
        val body = body
        val attrs = SimpleTextAttributes(titleStyle, UIUtil.getLabelForeground())
        if (body == null) {
            title.append(number, attrs)
        } else {
            title.append(body, attrs)
            title.append(" $number", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
    }

    private fun syncClick(next: String?) {
        if (url == next) return
        url = next
        val cursor = if (next != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        status.cursor = cursor
        title.cursor = cursor
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        changes.applyStyle(style)
        // Re-render the title so its foreground follows the theme, then repaint.
        renderTitle()
        changed()
    }

    private fun changed() {
        revalidate()
        repaint()
    }
}
