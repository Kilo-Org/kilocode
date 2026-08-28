package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.hoverTextButton
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.ui.ProductIcons
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import org.jetbrains.plugins.terminal.TerminalIcons

/**
 * Worktree session editor header. A thin wrapper over the shared [PrHeaderView] that adds the
 * Terminal and Open-in-window actions into the header's trailing slot.
 */
internal class WorktreePrHeaderView(
    openWorktree: () -> Unit = {},
    openEnabled: Boolean = true,
    openTerminal: () -> Unit = {},
    openDiff: () -> Unit,
) : BorderLayoutPanel() {
    private val core = PrHeaderView(openDiff = openDiff)
    private val terminal = hoverTextButton(
        ToolbarButtonAction(TerminalIcons.OpenTerminal_13x13, KiloBundle.message("worktree.session.terminal.action"), openTerminal),
        tooltip = KiloBundle.message("worktree.session.terminal.tooltip"),
    )
    private val open = hoverTextButton(
        ToolbarButtonAction(ProductIcons.getInstance().productIcon, KiloBundle.message("worktree.session.open.action"), openWorktree),
        tooltip = KiloBundle.message("worktree.session.open.tooltip"),
    )

    init {
        isOpaque = false
        open.isEnabled = openEnabled
        terminal.isEnabled = openEnabled
        core.addAction(terminal)
        core.addAction(open)
        addToCenter(core)
    }

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String) {
        core.update(stats, pull, name)
    }
}
