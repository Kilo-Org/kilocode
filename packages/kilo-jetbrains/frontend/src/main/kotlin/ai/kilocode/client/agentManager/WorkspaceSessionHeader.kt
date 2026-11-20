package ai.kilocode.client.agentManager

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.header.PrHeaderView
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.hoverIconButton
import ai.kilocode.client.ui.hoverTextButton
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.ui.ProductIcons
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.components.BorderLayoutPanel
import org.jetbrains.plugins.terminal.TerminalIcons
import javax.swing.JComponent

/** Same title, changes summary, and action slots for both workspace backends. */
internal open class WorkspaceSessionHeader @RequiresEdt constructor(
    openDiff: () -> Unit = {},
    onLocal: (() -> Unit)? = null,
    openPull: (() -> Unit)? = null,
    pullHint: String? = null,
    run: JComponent? = null,
    openWorktree: (() -> Unit)? = null,
    openEnabled: Boolean = true,
    openTerminal: (() -> Unit)? = null,
    status: JComponent? = null,
    persistentChanges: Boolean = false,
) : BorderLayoutPanel() {
    private val core = PrHeaderView(
        mode = ChangesPanel.Mode.FULL, openDiff = openDiff, onLocal = onLocal, fallback = true,
        openPull = openPull, pullHint = pullHint, persistentChanges = persistentChanges,
    )

    init {
        isOpaque = false
        addToCenter(core)
        status?.let(core::addAction)
        run?.let(core::addAction)
        openWorktree?.let { action ->
            core.addAction(hoverTextButton(
                ToolbarButtonAction(ProductIcons.getInstance().productIcon,
                    KiloBundle.message("worktree.session.open.action"), action),
                tooltip = KiloBundle.message("worktree.session.open.tooltip"),
            ).apply { isEnabled = openEnabled })
        }
        openTerminal?.let { action ->
            core.addAction(hoverIconButton(
                ToolbarButtonAction(TerminalIcons.OpenTerminal_13x13,
                    KiloBundle.message("worktree.session.terminal.tooltip"), action),
            ).apply { isEnabled = openEnabled })
        }
    }

    @RequiresEdt
    fun addAction(component: JComponent) = core.addAction(component)

    @RequiresEdt
    fun setChangeActions(onBase: (() -> Unit)?, onLocal: (() -> Unit)?) =
        core.setChangeActions(onBase, onLocal)

    @RequiresEdt
    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?, name: String, dirty: WorktreeDirtyDto? = null) {
        core.update(
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
            baseUnavailable = stats?.unavailable == true,
            baseReason = stats?.reason.orEmpty(),
            baseIncomplete = stats?.incomplete == true,
            localUnavailable = dirty?.unavailable == true,
            localReason = dirty?.reason.orEmpty(),
            localIncomplete = dirty?.incomplete == true,
        )
    }
}
