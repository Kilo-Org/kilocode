package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import javax.swing.Icon

/** A Cloud workspace row in the Agent Manager list, distinct from local worktrees. */
internal data class HostedWorkspaceRowData(
    val dto: HostedWorkspaceDto,
    val status: HostedWorkspaceStatusDto?,
    val kind: SessionActivityKind? = null,
)

internal class HostedWorkspaceRow(
    val data: HostedWorkspaceRowData,
) : ActiveListItem {
    private val dto get() = data.dto
    private val status get() = data.status

    override val key: String get() = dto.ref.key
    override val identity: Any get() = "hosted:${dto.ref.key}"
    override val title: String
        get() = HostedWorkspaceTitle.text(dto.name, dto.branch, dto.ref.workspaceID)
    override val description: String?
        get() = dto.branch?.takeIf { it.isNotBlank() }
    override val tooltip: String?
        get() = listOfNotNull(dto.repositoryUrl, dto.branch, dto.ref.key).joinToString("\n")
    override val icon: Icon get() = data.kind?.let { WorktreeIcons.forRow(busy = false, kind = it) }
        ?: HostedWorkspaceIcons.cloud
    override val tinted: Boolean get() = data.kind == null
    override val inlineBadges: Boolean get() = true
    override val section: String get() = KiloBundle.message("worktree.section.cloud")
    override val search: String
        get() = listOfNotNull(dto.name, dto.repositoryUrl, dto.branch, dto.ref.providerID, dto.ref.workspaceID)
            .joinToString(" ")
    override val badges: List<ActiveListBadge>
        get() = listOf(HostedWorkspaceStatus.of(status).badge())

    override fun equals(other: Any?): Boolean {
        val row = other as? HostedWorkspaceRow ?: return false
        return data == row.data
    }

    override fun hashCode(): Int = data.hashCode()
}
