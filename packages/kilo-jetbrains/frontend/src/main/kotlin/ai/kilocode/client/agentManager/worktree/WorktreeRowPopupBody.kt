package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.PrIcons
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.checksLabel
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.reviewLabel
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.Icon

/**
 * Everything known about one worktree's pull request, for the row hover popup, one thing per line: state,
 * verdict glyphs and title, then the full changes summary under a rule, then a line each for the review
 * and CI verdicts whose row glyphs have no room to say more than their color.
 *
 * Reuses [PrHeaderView] in [ChangesPanel.Mode.FULL] rather than laying out PR title, number, state badge
 * and diff counts again — that widget already renders the committed and uncommitted counts side by side
 * for the worktree session editor header. Stacked, because a popup has the vertical room the editor tab
 * header does not and a title squeezed against a row of counters is the thing this popup exists to show.
 */
internal class WorktreeRowPopupBody @RequiresEdt constructor(
    openDiff: () -> Unit,
    onLocal: (() -> Unit)? = null,
) : BorderLayoutPanel() {
    private val header = PrHeaderView(mode = ChangesPanel.Mode.FULL, onLocal = onLocal, stacked = true, openDiff = openDiff)
    private val review = JBLabel()
    private val checks = JBLabel()

    init {
        isOpaque = false
        addToCenter(
            Stack.vertical(UiStyle.Gap.sm())
                .next(header)
                .next(review)
                .next(checks),
        )
    }

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String, dirty: WorktreeDirtyDto?) {
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
        line(review, PrIcons.review(pull?.review ?: GhReview.NONE), reviewLabel(pull?.review ?: GhReview.NONE))
        line(checks, PrIcons.checks(pull?.checks ?: GhChecksDto()), checksLabel(pull?.checks ?: GhChecksDto()))
    }

    /** Hidden when there is no glyph, so a PR with no CI does not leave an empty row behind. */
    @RequiresEdt
    private fun line(label: JBLabel, glyph: Icon?, text: String) {
        val show = glyph != null && text.isNotBlank()
        if (label.isVisible != show) label.isVisible = show
        if (!show) return
        if (label.icon !== glyph) label.icon = glyph
        if (label.text != text) label.text = text
    }
}
