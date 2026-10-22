package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.checksTooltip
import ai.kilocode.client.ui.checksUrl
import ai.kilocode.client.ui.commentsCount
import ai.kilocode.client.ui.commentsTooltip
import ai.kilocode.client.ui.conflicted
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
import javax.swing.Icon
import javax.swing.JSeparator
import javax.swing.SwingConstants

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
    // Unresolved review conversations, review verdict, then CI verdict, between the state pill and the
    // title: the same order and the same glyphs the worktree rows show, so a header and its row do not
    // disagree about what a PR is waiting on.
    private val comments = JBLabel()
    private val review = JBLabel()
    private val checks = JBLabel()
    // Every element of the header opens something in the browser, so every element gets the standard
    // hover pill. Without it the state pill, the title, and the verdicts read as static text that
    // happens to change the cursor, while the changes summary beside them lights up on hover.
    private val statusArea = HoverArea(status)
    private val titleArea = HoverArea(title)
    private val commentsArea = HoverArea(comments)
    private val reviewArea = HoverArea(review)
    private val checksArea = HoverArea(checks)
    private val statusPane = Stack.horizontal(UiStyle.Gap.xs())
        .next(statusArea)
        .next(commentsArea)
        .next(reviewArea)
        .next(checksArea)
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
        // The leading pad belongs to the strip rather than the pill: on the pill it would sit inside the
        // hover fill and leave the state badge off-centre in its own highlight.
        statusPane.border = JBUI.Borders.emptyLeft(UiStyle.Gap.SM)
        status.isVisible = false
        statusArea.isVisible = false
        comments.isVisible = false
        commentsArea.isVisible = false
        review.isVisible = false
        reviewArea.isVisible = false
        checks.isVisible = false
        checksArea.isVisible = false
        title.isOpaque = false
        title.isVisible = false
        titleArea.isVisible = false
        head.isOpaque = false
        // The state pill and the verdict glyphs pin to the top of the stacked header, so they stay on
        // the title line rather than floating down beside the summary row under it.
        val bar = if (stacked) VAlign.TOP else VAlign.CENTER
        head.addToLeft(statusPane.align(HAlign.LEFT, bar))
        // Hugged rather than stretched: the centre slot is everything left over between the verdicts and
        // the toolbar, and a hover pill spanning all of it would highlight far more than the title.
        head.addToCenter(titleArea.align(HAlign.LEFT, VAlign.CENTER))
        head.addToRight(actions.align(HAlign.RIGHT, bar))
        if (summary == null) {
            addToCenter(head)
        } else {
            addToTop(head)
            addToCenter(summary)
        }
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
        syncCommentsStyle()
    }

    /**
     * The conversation count is the one glyph carrying text. Sized and spaced like the ahead/behind counters
     * in the changes summary beside it — the tight gap keeps glyph and figure reading as one token rather
     * than an icon with a caption.
     *
     * Ordinary label foreground rather than the secondary tone the summary uses: the count is a figure meant
     * to be read, and the muted blend left it fainter than the neutral glyph in front of it.
     */
    @RequiresEdt
    private fun syncCommentsStyle() {
        comments.font = style.smallFont
        comments.foreground = UIUtil.getLabelForeground()
        comments.iconTextGap = UiStyle.Gap.xs()
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
        changes.update(
            files, additions, deletions, ahead, behind, localFiles, localAdditions, localDeletions, base,
            conflict = conflicted(pull),
        )
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
        statusArea.tooltip(tip)
    }

    @RequiresEdt
    private fun syncVerdicts(pull: WorktreePrDto?) {
        runs = pull?.let(::checksUrl)
        val talk = glyph(
            commentsArea,
            comments,
            pull?.let { PrIcons.comments(it.comments) },
            pull?.let { commentsTooltip(it.comments) },
            url,
            pull?.let { commentsCount(it.comments) }.orEmpty(),
        )
        val verdict = glyph(reviewArea, review, pull?.let { PrIcons.review(it.review) }, pull?.let { reviewTooltip(it.review) }, url)
        val build = glyph(checksArea, checks, pull?.let { PrIcons.checks(it.checks) }, pull?.let { checksTooltip(it.checks) }, runs)
        if (talk || verdict || build) changed()
    }

    /**
     * Applies one verdict glyph, answering whether the header has to lay out again. A verdict with no
     * glyph — no CI on the head, a review nobody has given yet — hides both the label and its hover area
     * rather than leaving a gap after the state pill.
     *
     * [text] labels the glyph for a verdict that is a quantity rather than a state. Its own changes count
     * toward the return: a count that grew needs the row measured again even though nothing appeared.
     */
    @RequiresEdt
    private fun glyph(area: HoverArea, label: JBLabel, icon: Icon?, tip: String?, link: String?, text: String = ""): Boolean {
        val show = icon != null && !tip.isNullOrBlank()
        var moved = area.isVisible != show
        if (moved) {
            area.isVisible = show
            label.isVisible = show
        }
        if (label.icon !== icon) label.icon = icon
        val next = if (show) text else ""
        if (label.text != next) {
            label.text = next
            moved = true
        }
        area.tooltip(tip)
        area.action = link?.let { { BrowserUtil.browse(it) } }
        return moved
    }

    @RequiresEdt
    private fun syncStatus(next: GhState?) {
        if (state == next) return
        state = next
        status.icon = next?.let { FilledBadgeIcon(stateLabel(it), style(it)) }
        status.isVisible = next != null
        statusArea.isVisible = next != null
        changed()
    }

    @RequiresEdt
    private fun syncPr(value: Boolean) {
        if (title.isVisible == value) return
        title.isVisible = value
        titleArea.isVisible = value
        changed()
    }

    @RequiresEdt
    private fun clearTitle() {
        if (number == null && tip == null) return
        number = null
        body = null
        tip = null
        title.clear()
        titleArea.tooltip(null)
        statusArea.tooltip(null)
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
            titleArea.tooltip(next)
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
        val open = next?.let { { BrowserUtil.browse(it) } }
        statusArea.action = open
        titleArea.action = open
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        changes.font = style.smallFont
        changes.foreground = SessionUiStyle.Text.Secondary.foreground()
        syncCommentsStyle()
        syncText()
        changed()
    }

    @RequiresEdt
    private fun changed() {
        revalidate()
        repaint()
    }
}
