package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.worktree.isDefaultSessionTitle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.history.HostedHistoryItem
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListBadge

internal class HostedSessionRow(
    private val item: HostedHistoryItem,
    private val kind: SessionActivityKind?,
    private val live: String?,
    private val closed: Boolean,
    private val toggle: (HostedHistoryItem) -> Unit,
) : ActiveListItem {
    override val key: String get() = item.id
    override val title: String
        get() {
            val name = live?.takeIf { it.isNotBlank() } ?: item.title
            if (name.isBlank()) return KiloBundle.message("hosted.workspace.session.untitled")
            if (isDefaultSessionTitle(name)) return KiloBundle.message("worktree.session.new")
            return name
        }
    override val note: String? get() = if (closed) KiloBundle.message("hosted.workspace.session.closed") else null
    override val tooltip: String get() = title
    override val section: String get() = HistoryTime.title(HistoryTime.section(item))
    override val badges: List<ActiveListBadge>
        get() = listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })
    override val cells: List<ActiveListCell>
        get() = listOf(
            ActiveListCell(
                id = if (closed) "reopen" else "close",
                label = KiloBundle.message(if (closed) "hosted.workspace.session.reopen" else "hosted.workspace.session.close"),
                enabled = true,
                action = { toggle(item) },
            ),
        )

    override fun equals(other: Any?): Boolean {
        val row = other as? HostedSessionRow ?: return false
        return item == row.item && kind == row.kind && live == row.live && closed == row.closed
    }

    override fun hashCode(): Int = listOf(item, kind, live, closed).hashCode()
}
