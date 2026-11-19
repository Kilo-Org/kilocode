package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerFacade
import ai.kilocode.client.agentManager.AgentManagerRowData
import ai.kilocode.client.agentManager.AgentManagerWorkspaceRow
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.WorktreePrDto

/** A Cloud workspace row in the Agent Manager tree, distinct from local worktrees. */
internal data class HostedWorkspaceRowData(
    val dto: HostedWorkspaceDto,
    val status: HostedWorkspaceStatusDto?,
    val kind: SessionActivityKind? = null,
    override val progress: String? = null,
) : AgentManagerRowData {
    override val element = AgentManagerElement.Cloud(dto)
    override val identity: Any get() = "hosted:${dto.ref.key}"
    override fun title(pr: WorktreePrDto?): String = HostedWorkspaceTitle.text(dto)
    override val description: String? get() = dto.branch?.takeIf { it.isNotBlank() }
    override val tooltip: String get() = listOfNotNull(dto.repositoryUrl, dto.branch, dto.ref.key).joinToString("\n")
    override val icon get() = kind?.let { WorktreeIcons.forRow(busy = progress != null, kind = it) }
        ?: progress?.let { WorktreeIcons.forRow(busy = true, kind = null) }
        ?: HostedWorkspaceIcons.cloud
    override val tinted get() = kind == null && progress == null
    override val search: String get() = (listOfNotNull(dto.name, dto.repositoryUrl, dto.branch, dto.ref.providerID,
        dto.ref.workspaceID) + dto.sessions.mapNotNull { it.title }).joinToString(" ")
    override val section get() = KiloBundle.message("worktree.section.cloud")
    override val compute get() = HostedWorkspaceStatus.of(status).badge()
}

internal fun hostedWorkspaceRow(
    data: HostedWorkspaceRowData,
    facade: AgentManagerFacade,
): AgentManagerWorkspaceRow<HostedWorkspaceRowData> {
    return AgentManagerWorkspaceRow(data, facade)
}
