package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.hoverTextButton
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.ui.ProductIcons
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import org.jetbrains.plugins.terminal.TerminalIcons
import javax.swing.JComponent

/**
 * Worktree session editor header. A thin wrapper over the shared [PrHeaderView] that adds the
 * optional Run control plus Open-in-window and Terminal actions into the header's trailing slot.
 */
internal class WorktreePrHeaderView(
    openWorktree: () -> Unit = {},
    openEnabled: Boolean = true,
    openTerminal: () -> Unit = {},
    run: JComponent? = null,
    openDiff: () -> Unit,
) : BorderLayoutPanel() {
    private val core = PrHeaderView(openDiff = openDiff)
    private val open = hoverTextButton(
        ToolbarButtonAction(ProductIcons.getInstance().productIcon, KiloBundle.message("worktree.session.open.action"), openWorktree),
        tooltip = KiloBundle.message("worktree.session.open.tooltip"),
    )
    // Icon-only: the tooltip text stands in for the visible label and doubles as the accessible name.
    private val terminal = toolbarButton(
        ToolbarButtonAction(TerminalIcons.OpenTerminal_13x13, KiloBundle.message("worktree.session.terminal.tooltip"), openTerminal),
    )

    init {
        isOpaque = false
        open.isEnabled = openEnabled
        terminal.isEnabled = openEnabled
        run?.let { core.addAction(it) }
        core.addAction(open)
        core.addAction(terminal)
        addToCenter(core)
    }

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String) {
        core.update(stats, pull, name)
    }
}
