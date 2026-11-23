package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import javax.swing.JComponent

/** Source-compatible factory; local and Cloud editors both render [WorkspaceSessionHeader]. */
internal typealias WorktreePrHeaderView = WorkspaceSessionHeader

internal fun WorktreePrHeaderView(
    openWorktree: () -> Unit = {},
    openEnabled: Boolean = true,
    openTerminal: () -> Unit = {},
    onLocal: (() -> Unit)? = null,
    run: JComponent? = null,
    openDiff: () -> Unit,
): WorkspaceSessionHeader = WorkspaceSessionHeader(
    openDiff = openDiff,
    onLocal = onLocal,
    run = run,
    openWorktree = openWorktree,
    openEnabled = openEnabled,
    openTerminal = openTerminal,
)
