package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.agentManager.worktree.WorktreeTitle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveMetrics
import ai.kilocode.client.ui.list.ActiveSection
import com.intellij.util.concurrency.annotations.RequiresEdt
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreePrDto
import javax.swing.Icon

internal interface AgentManagerRowData {
    val element: AgentManagerElement
    val identity: Any
    fun title(pr: WorktreePrDto?): String
    val description: String?
    val tooltip: String?
    val icon: Icon?
    val tinted: Boolean
    val search: String?
    val progress: String?
    val section: String?
    /** Cloud's only additional row presentation: its passive compute status. */
    val compute: ActiveBadge? get() = null
}

internal data class LocalWorkspaceRowData(
    val dto: WorktreeDto,
    val kind: SessionActivityKind?,
    val current: Boolean,
    val running: Boolean,
    override val progress: String?,
) : AgentManagerRowData {
    override val element = AgentManagerElement.Local(dto)
    override val identity: Any get() = if (current) "local:${dto.path}" else "worktree:${dto.path}"
    override fun title(pr: WorktreePrDto?): String = if (current) dto.branch else WorktreeTitle.text(dto.name, dto.path, pr)
    override val description get() = WorktreeTitle.fallback(dto.path)
    override val tooltip: String? = null
    override val icon get() = WorktreeIcons.forRow(progress != null, kind, dto.locked, current, running)
    override val tinted get() = WorktreeIcons.neutral(icon)
    override val search get() = listOfNotNull(dto.name, dto.branch, dto.path, dto.lockReason).joinToString(" ")
    override val section: String? = null
}

/** One row model and renderer contract for local and Cloud workspaces. */
internal class AgentManagerWorkspaceRow<T : AgentManagerRowData> @RequiresEdt constructor(
    val data: T,
    facade: AgentManagerFacade,
) : ActiveSection, AgentManagerRow {
    private val marks = AgentManagerBadges(facade, data.element)

    override val element get() = data.element
    override val key get() = element.key
    override val identity get() = data.identity
    override val title get() = data.title(marks.state.pr)
    override val description get() = data.description
    override val tooltip get() = data.tooltip
    override val icon get() = data.icon
    override val tinted get() = data.tinted
    override val search: String get() = listOfNotNull(
        data.search,
        marks.state.pr?.title,
        marks.state.pr?.let { "#${it.number}" },
    ).joinToString(" ")
    override val progress get() = data.progress
    override val section get() = data.section
    override val badges: List<ActiveBadge>
        get() = if (progress == null && !marks.state.busy) listOfNotNull(data.compute) + marks.primary else emptyList()
    override val secondaryBadges: List<ActiveBadge>
        get() = if (progress == null && !marks.state.busy) marks.secondary else emptyList()
    override val metrics: ActiveMetrics?
        get() = if (progress == null && !marks.state.busy) marks.metrics else null

    override fun equals(other: Any?): Boolean {
        val row = other as? AgentManagerWorkspaceRow<*> ?: return false
        return data == row.data && marks.state == row.marks.state
    }

    override fun hashCode(): Int = 31 * data.hashCode() + marks.state.hashCode()
}
