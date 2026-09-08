package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.ConflictDotIcon
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.checksLabel
import ai.kilocode.client.ui.checksOpenTooltip
import ai.kilocode.client.ui.checksUrl
import ai.kilocode.client.ui.commentsLabel
import ai.kilocode.client.ui.commentsOpenTooltip
import ai.kilocode.client.ui.conflicted
import ai.kilocode.client.ui.mergeLabel
import ai.kilocode.client.ui.openTooltip
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.ui.reviewLabel
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.BrowserUtil
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.Icon
import javax.swing.JComponent

/**
 * Everything known about one worktree's pull request, for the row hover popup, one thing per line: state,
 * verdict glyphs and title, then the full changes summary under a rule, then a line each for the merge
 * verdict, the unresolved review conversations, the review verdict, and the CI verdict — whose row marks have
 * no room to say more than their color and their count. Same order as the glyph strip above them, after the
 * merge verdict, which is marked on the changes badge rather than in that strip.
 *
 * Only a row that has a pull request gets one, which is why [update] takes a non-null one: without that
 * chrome the popup is a restatement of the counts already on the row.
 *
 * Reuses [PrHeaderView] in [ChangesPanel.Mode.FULL] rather than laying out PR title, number, state badge
 * and diff counts again — that widget already renders the committed and uncommitted counts side by side
 * for the worktree session editor header. Stacked, because a popup has the vertical room the editor tab
 * header does not and a title squeezed against a row of counters is the thing this popup exists to show.
 *
 * Every line opens the page it is talking about, with the standard hover pill: the popup is the one surface
 * that names each verdict in words, so it is where someone reads "2 of 5 checks failed" and wants the log.
 */
internal class WorktreeRowPopupBody @RequiresEdt constructor(
    openDiff: () -> Unit,
    onLocal: (() -> Unit)? = null,
) : BorderLayoutPanel() {
    private val header = PrHeaderView(mode = ChangesPanel.Mode.FULL, onLocal = onLocal, stacked = true, openDiff = openDiff)
    private val merge = Line()
    private val comments = Line()
    private val review = Line()
    private val checks = Line()

    init {
        isOpaque = false
        addToCenter(
            Stack.vertical(UiStyle.Gap.sm())
                .next(header)
                // The merge verdict leads the lines: it is the one that is about the changes summary directly
                // above it, and it outranks the rest — a review approving a diff that will not merge is not
                // the next thing anybody acts on.
                .next(merge.slot)
                .next(comments.slot)
                .next(review.slot)
                .next(checks.slot),
        )
    }

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto, name: String, dirty: WorktreeDirtyDto?) {
        header.update(
            files = stats?.files ?: 0,
            additions = stats?.additions ?: 0,
            deletions = stats?.deletions ?: 0,
            pull = pull,
            name = name,
            ahead = stats?.ahead ?: 0,
            behind = stats?.behind ?: 0,
            localFiles = dirty?.files ?: 0,
            localAdditions = dirty?.additions ?: 0,
            localDeletions = dirty?.deletions ?: 0,
            base = stats?.base.orEmpty(),
        )
        // Each line already states its verdict, so the tooltips carry only the click hint. Repeating
        // "19 checks passed" over a line that reads "19 checks passed" tells the user nothing.
        //
        // The merge line is marked with the same red dot the changes badge is marked with, and carries the
        // same sentence the badge's tooltip leads with, so the mark above and the words below match. Blank
        // text when the branches merge, which is what hides the line.
        val conflict = if (conflicted(pull)) mergeLabel(stats?.base.orEmpty()) else ""
        merge.update(ConflictDotIcon, conflict, pull.url, openTooltip())
        comments.update(PrIcons.comments(pull.comments), commentsLabel(pull.comments), pull.url, commentsOpenTooltip())
        review.update(PrIcons.review(pull.review), reviewLabel(pull.review), pull.url, openTooltip())
        // The checks tab rather than the conversation: someone reading a failure count wants the log.
        checks.update(PrIcons.checks(pull.checks), checksLabel(pull.checks), checksUrl(pull), checksOpenTooltip())
    }

    /**
     * One verdict line: a glyph, its sentence, and the page it opens under the standard hover pill.
     *
     * [slot] is what the column holds rather than the area itself, because a vertical
     * [Stack] stretches its children to the full width and a pill spanning the whole popup would
     * highlight far more than the line. Hiding is applied to the slot so the column closes up, and to the
     * label as well so a hidden line reports itself as hidden however it is inspected.
     */
    private class Line @RequiresEdt constructor() {
        private val label = JBLabel()
        private val area = HoverArea(label)
        val slot: JComponent = area.align(HAlign.LEFT, VAlign.CENTER)

        /** Hidden when there is no glyph, so a PR with no CI does not leave an empty row behind. */
        @RequiresEdt
        fun update(glyph: Icon?, text: String, link: String, tip: String) {
            val show = glyph != null && text.isNotBlank()
            if (slot.isVisible != show) {
                slot.isVisible = show
                label.isVisible = show
            }
            if (!show) return
            if (label.icon !== glyph) label.icon = glyph
            if (label.text != text) label.text = text
            // Announced by its sentence rather than by the hint, which alone would not say what opens.
            area.tooltip(tip, name = text)
            area.action = { BrowserUtil.browse(link) }
        }
    }
}
