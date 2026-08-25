package ai.kilocode.client.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.xml.util.XmlStringUtil

/**
 * Shared PR badge helpers used by both the Agent Manager worktree views and the chat session header.
 * Lives in the neutral `ui` package so `session/ui/header/` does not depend on the Agent Manager
 * package.
 */

internal fun style(state: GhState): UiStyle.Badge.Style = when (state) {
    GhState.OPEN -> UiStyle.Badge.PullRequestOpen
    GhState.DRAFT -> UiStyle.Badge.PullRequestDraft
    GhState.MERGED -> UiStyle.Badge.PullRequestMerged
    GhState.CLOSED -> UiStyle.Badge.PullRequestClosed
}

internal fun stateLabel(state: GhState): String = when (state) {
    GhState.OPEN -> KiloBundle.message("worktree.pr.state.open")
    GhState.DRAFT -> KiloBundle.message("worktree.pr.state.draft")
    GhState.MERGED -> KiloBundle.message("worktree.pr.state.merged")
    GhState.CLOSED -> KiloBundle.message("worktree.pr.state.closed")
}

internal fun prTooltip(pull: WorktreePrDto, name: String? = null): String {
    val title = pull.title.trim()
    val head = buildString {
        append(stateLabel(pull.state))
        append(" #")
        append(pull.number)
        if (title.isNotBlank()) {
            append(' ')
            append(title)
        }
    }
    val lines = listOfNotNull(
        head,
        name?.takeIf { title.isNotBlank() }?.let { "($it)" },
        KiloBundle.message("worktree.pr.tooltip.open"),
    ).map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}
