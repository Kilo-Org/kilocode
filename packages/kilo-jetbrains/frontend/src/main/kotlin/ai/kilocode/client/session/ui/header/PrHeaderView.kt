package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.checksTooltip
import ai.kilocode.client.ui.checksUrl
import ai.kilocode.client.ui.prTooltip
import ai.kilocode.client.ui.reviewTooltip
import ai.kilocode.client.ui.stateLabel
import ai.kilocode.client.ui.style
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
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
import javax.swing.Icon
import javax.swing.JSeparator
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

internal class PrHeaderView @RequiresEdt constructor(
    private val titleStyle: Int = SimpleTextAttributes.STYLE_BOLD,
    mode: ChangesPanel.Mode = ChangesPanel.Mode.COMPACT,
    onLocal: (() -> Unit)? = null,
    /**
     * Give the changes summary its own row under a rule instead of trailing the title. For a popup,
     * which has the vertical room a toolbar row does not and would otherwise squeeze the title against
     * a long line of counters.
     */
    stacked: Boolean = false,
    openDiff: () -> Unit,
) : BorderLayoutPanel(), SessionEditorStyleTarget {
    private val status = JBLabel()
    private val title = SimpleColoredComponent()
    private val changes = ChangesPanel(mode, onBase = openDiff, onLocal = onLocal)
    // Review then CI verdict, between the state pill and the title: the same order and the same glyphs
    // the worktree rows show, so a header and its row do not disagree about what a PR is waiting on.
    private val review = JBLabel()
    private val checks = JBLabel()
    private val statusPane = Stack.horizontal(UiStyle.Gap.xs())
        .next(status.align(HAlign.LEFT, VAlign.CENTER))
        .next(review)
        .next(checks)
    // Hidden until the first action is added: hosts with no trailing actions (e.g. BranchDock) show
    // just the changes summary, so an always-visible separator would dangle with nothing after it.
    private val actionsSeparator = JSeparator(SwingConstants.VERTICAL).apply { isVisible = false }
    private val actions = Stack.horizontal(UiStyle.Gap.sm()).apply {
        if (!stacked) next(changes.align(HAlign.CENTER, VAlign.CENTER))
        next(actionsSeparator)
    }
    private val divider = if (stacked) JSeparator(SwingConstants.HORIZONTAL) else null
    // The rule spans the body while the counters keep the header's own leading padding, so the summary
    // starts under the state pill rather than flush against the popup border.
    private val summary = divider?.let {
        Stack.vertical(UiStyle.Gap.sm())
            .next(it)
            .next(changes.align(HAlign.LEFT, VAlign.CENTER).apply { border = JBUI.Borders.emptyLeft(UiStyle.Gap.sm()) })
    }
    private val head = BorderLayoutPanel()
    private var style = SessionEditorStyle.current()
    private var actionCount = 0
    private var state: GhState? = null
    private var number: String? = null
    private var body: String? = null
    private var tip: String? = null
    private var url: String? = null
    private var runs: String? = null

    init {
        isOpaque = false
        // Standard padding fences the toolbar off from the PR title on the left.
        actions.border = JBUI.Borders.empty(0, UiStyle.Gap.md(), 0, UiStyle.Gap.sm())
        status.border = JBUI.Borders.empty(0, UiStyle.Gap.md(), 0, UiStyle.Gap.xs())
        status.isVisible = false
        review.isVisible = false
        checks.isVisible = false
        title.border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        title.isOpaque = false
        title.isVisible = false
        head.isOpaque = false
        // The state pill and the verdict glyphs pin to the top of the stacked header, so they stay on
        // the title line rather than floating down beside the summary row under it.
        val bar = if (stacked) VAlign.TOP else VAlign.CENTER
        head.addToLeft(statusPane.align(HAlign.LEFT, bar))
        head.addToCenter(title)
        head.addToRight(actions.align(HAlign.RIGHT, bar))
        if (summary == null) {
            addToCenter(head)
        } else {
            addToTop(head)
            addToCenter(summary)
        }
        val listener = object : MouseAdapter() {
            @RequiresEdt
            override fun mouseClicked(event: MouseEvent) {
                if (event.isConsumed || event.isPopupTrigger || !SwingUtilities.isLeftMouseButton(event) || event.clickCount != 1) return
                if (isEnabled && event.component.isEnabled) url?.let(BrowserUtil::browse)
            }
        }
        status.addMouseListener(listener)
        title.addMouseListener(listener)
        review.addMouseListener(listener)
        // The checks tab rather than the conversation: someone clicking a red build wants the log.
        checks.addMouseListener(object : MouseAdapter() {
            @RequiresEdt
            override fun mouseClicked(event: MouseEvent) {
                if (event.isConsumed || event.isPopupTrigger || !SwingUtilities.isLeftMouseButton(event) || event.clickCount != 1) return
                if (isEnabled && event.component.isEnabled) runs?.let(BrowserUtil::browse)
            }
        })
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    @RequiresEdt
    fun addAction(component: Component) {
        actionCount++
        actions.next(component.align(HAlign.CENTER, VAlign.CENTER))
        syncSeparator()
    }

    @RequiresEdt
    fun update(
        files: Int,
        additions: Int,
        deletions: Int,
        pull: WorktreePrDto?,
        name: String,
        ahead: Int = 0,
        behind: Int = 0,
        localFiles: Int = 0,
        localAdditions: Int = 0,
        localDeletions: Int = 0,
        base: String = "",
    ) {
        changes.update(files, additions, deletions, ahead, behind, localFiles, localAdditions, localDeletions, base)
        syncSeparator()
        applyPr(pull, name)
    }

    @RequiresEdt
    private fun syncSeparator() {
        val visible = actionCount > 0 && changes.isVisible
        if (actionsSeparator.isVisible != visible) actionsSeparator.isVisible = visible
        // The rule exists only to fence the summary row off from the header line above it.
        divider?.let { if (it.isVisible != changes.isVisible) it.isVisible = changes.isVisible }
    }

    @RequiresEdt
    private fun applyPr(pull: WorktreePrDto?, name: String) {
        if (pull == null) {
            syncPr(false)
            syncStatus(null)
            clearTitle()
            syncClick(null)
            syncVerdicts(null)
            return
        }
        syncPr(true)
        val trimmed = pull.title.trim()
        val body = trimmed.takeIf { it.isNotBlank() }
        val tip = prTooltip(pull, name.takeIf { it.isNotBlank() && it != trimmed })
        syncStatus(pull.state)
        syncTitle("#${pull.number}", body, tip)
        syncClick(pull.url)
        syncVerdicts(pull)
        if (status.toolTipText != tip) status.toolTipText = tip
    }

    @RequiresEdt
    private fun syncVerdicts(pull: WorktreePrDto?) {
        runs = pull?.let(::checksUrl)
        val verdict = glyph(review, pull?.let { PrIcons.review(it.review) }, pull?.let { reviewTooltip(it.review) }, url)
        val build = glyph(checks, pull?.let { PrIcons.checks(it.checks) }, pull?.let { checksTooltip(it.checks) }, runs)
        if (verdict || build) changed()
    }

    /**
     * Applies one verdict glyph, answering whether the header has to lay out again. A verdict with no
     * glyph — no CI on the head, a review nobody has given yet — hides the label rather than leaving a
     * gap after the state pill.
     */
    @RequiresEdt
    private fun glyph(label: JBLabel, icon: Icon?, tip: String?, link: String?): Boolean {
        val show = icon != null && !tip.isNullOrBlank()
        val moved = label.isVisible != show
        if (moved) label.isVisible = show
        if (label.icon !== icon) label.icon = icon
        if (label.toolTipText != tip) label.toolTipText = tip
        val cursor = if (show && link != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        if (label.cursor != cursor) label.cursor = cursor
        return moved
    }

    @RequiresEdt
    private fun syncStatus(next: GhState?) {
        if (state == next) return
        state = next
        status.icon = next?.let { FilledBadgeIcon(stateLabel(it), style(it)) }
        status.isVisible = next != null
        changed()
    }

    @RequiresEdt
    private fun syncPr(value: Boolean) {
        if (title.isVisible == value) return
        title.isVisible = value
        changed()
    }

    @RequiresEdt
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

    @RequiresEdt
    private fun syncTitle(number: String, body: String?, next: String?) {
        var changed = false
        if (this.number != number || this.body != body) {
            this.number = number
            this.body = body
            syncText()
            changed = true
        }
        if (tip != next) {
            tip = next
            title.toolTipText = next
            changed = true
        }
        if (changed) changed()
    }

    @RequiresEdt
    private fun syncText() {
        val number = number ?: return
        title.clear()
        val body = body
        val attrs = SimpleTextAttributes(titleStyle, UIUtil.getLabelForeground())
        if (body == null) {
            title.append(number, attrs)
            return
        }
        title.append(body, attrs)
        title.append(" $number", SimpleTextAttributes.GRAYED_ATTRIBUTES)
    }

    @RequiresEdt
    private fun syncClick(next: String?) {
        if (url == next) return
        url = next
        val cursor = if (next != null) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        status.cursor = cursor
        title.cursor = cursor
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
        syncText()
        changed()
    }

    @RequiresEdt
    private fun changed() {
        revalidate()
        repaint()
    }
}
