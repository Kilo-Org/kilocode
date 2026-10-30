package ai.kilocode.client.agentManager

import ai.kilocode.client.agentManager.worktree.isDefaultSessionTitle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.history.HistoryItem
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListItem

internal data class WorkspaceSessionRow(
    val item: HistoryItem,
    private val kind: SessionActivityKind?,
    private val deleting: Boolean = false,
    private val live: String? = null,
    override val search: String = "",
) : ActiveListItem {
    override val key: String get() = item.id
    override val title: String get() {
        val name = live?.takeIf { it.isNotBlank() } ?: item.title
        if (name.isBlank()) return KiloBundle.message("worktree.session.untitled")
        if (isDefaultSessionTitle(name)) return KiloBundle.message("worktree.session.new")
        return name
    }
    override val tooltip: String get() = title
    override val progress: String? get() = if (deleting) KiloBundle.message("common.deleting") else null
    override val badges: List<ActiveListBadge>
        get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })
    override val section: String get() = HistoryTime.title(HistoryTime.section(item))
}
