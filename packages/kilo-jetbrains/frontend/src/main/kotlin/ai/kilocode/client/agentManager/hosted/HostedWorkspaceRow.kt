package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.icons.AllIcons

/** A Cloud workspace row in the Agent Manager list, distinct from local worktrees. */
internal data class HostedWorkspaceRowData(
    val dto: HostedWorkspaceDto,
    val status: HostedWorkspaceStatusDto?,
)

internal class HostedWorkspaceRow(
    val data: HostedWorkspaceRowData,
) : ActiveListItem {
    private val dto get() = data.dto
    private val status get() = data.status

    override val key: String get() = dto.ref.key
    override val identity: Any get() = "hosted:${dto.ref.key}"
    override val title: String
        get() = dto.name?.takeIf { it.isNotBlank() }
            ?: dto.repositoryUrl?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
            ?: dto.ref.workspaceID
    override val description: String?
        get() = listOfNotNull(
            dto.branch?.takeIf { it.isNotBlank() },
            dto.sessions.size.takeIf { it > 0 }?.let { KiloBundle.message("hosted.workspace.session.count", it) },
        ).joinToString(" · ").takeIf { it.isNotBlank() }
    override val tooltip: String?
        get() = listOfNotNull(dto.repositoryUrl, dto.branch, dto.ref.key).joinToString("\n")
    override val icon = AllIcons.General.Web
    override val section: String get() = KiloBundle.message("worktree.section.cloud")
    override val search: String
        get() = listOfNotNull(dto.name, dto.repositoryUrl, dto.branch, dto.ref.providerID, dto.ref.workspaceID)
            .joinToString(" ")
    override val badges: List<ActiveListBadge>
        get() = listOfNotNull(
            status?.computeStatus?.takeIf { it.isNotBlank() }?.let {
                val label = when (it) {
                    "running" -> "active"
                    "sleeping", "starting", "stopping", "stopped", "unavailable" -> it
                    else -> "unknown"
                }
                ActiveListBadge(
                    KiloBundle.message("hosted.workspace.status.$label"),
                    if (it == "running") UiStyle.Badge.ActivityRunning else UiStyle.Badge.Secondary,
                    id = "cloud-compute",
                )
            },
        )

    override fun equals(other: Any?): Boolean {
        val row = other as? HostedWorkspaceRow ?: return false
        return dto == row.dto && status == row.status
    }

    override fun hashCode(): Int = 31 * dto.hashCode() + (status?.hashCode() ?: 0)
}
