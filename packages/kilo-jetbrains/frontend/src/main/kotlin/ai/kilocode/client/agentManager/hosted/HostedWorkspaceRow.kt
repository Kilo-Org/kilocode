package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.agentManager.AgentManagerBadges
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerFacade
import ai.kilocode.client.agentManager.AgentManagerRow
import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveMetrics
import ai.kilocode.client.ui.list.ActiveSection
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.Icon

/** A Cloud workspace row in the Agent Manager tree, distinct from local worktrees. */
internal data class HostedWorkspaceRowData(
    val dto: HostedWorkspaceDto,
    val status: HostedWorkspaceStatusDto?,
    val kind: SessionActivityKind? = null,
    val progress: String? = null,
    val pull: WorktreePrDto? = null,
)

internal class HostedWorkspaceRow @RequiresEdt constructor(
    val data: HostedWorkspaceRowData,
    facade: AgentManagerFacade,
) : ActiveSection, AgentManagerRow {
    private val dto get() = data.dto
    private val status get() = data.status
    override val element = AgentManagerElement.Cloud(dto)
    private val marks = AgentManagerBadges(facade, element)

    override val key: String get() = dto.ref.key
    override val identity: Any get() = "hosted:${dto.ref.key}"
    override val title: String
        get() = HostedWorkspaceTitle.text(dto)
    override val description: String?
        get() = dto.branch?.takeIf { it.isNotBlank() }
    override val tooltip: String?
        get() = listOfNotNull(dto.repositoryUrl, dto.branch, dto.ref.key).joinToString("\n")
    override val icon: Icon get() = data.kind?.let { WorktreeIcons.forRow(busy = data.progress != null, kind = it) }
        ?: data.progress?.let { WorktreeIcons.forRow(busy = true, kind = null) }
        ?: HostedWorkspaceIcons.cloud
    override val tinted: Boolean get() = data.kind == null && data.progress == null
    override val inlineBadges: Boolean get() = true
    override val section: String get() = KiloBundle.message("worktree.section.cloud")
    override val search: String
        get() = (listOfNotNull(
            dto.name,
            dto.repositoryUrl,
            dto.branch,
            dto.ref.providerID,
            dto.ref.workspaceID,
            marks.state.pr?.title,
            marks.state.pr?.let { "#${it.number}" },
        ) + dto.sessions.mapNotNull { it.title }).joinToString(" ")
    override val progress: String? get() = data.progress
    override val badges: List<ActiveBadge>
        get() = if (data.progress == null && !marks.state.busy) {
            listOf(HostedWorkspaceStatus.of(status).badge()) + marks.primary
        } else {
            emptyList()
        }

    /** The `#<number>` pill below the title, matching a worktree row's secondary line. */
    override val secondaryBadges: List<ActiveBadge>
        get() = if (data.progress == null) marks.secondary else emptyList()

    override val metrics: ActiveMetrics? get() = marks.metrics

    override fun equals(other: Any?): Boolean {
        val row = other as? HostedWorkspaceRow ?: return false
        return data == row.data && marks.state == row.marks.state
    }

    override fun hashCode(): Int = 31 * data.hashCode() + marks.state.hashCode()
}
