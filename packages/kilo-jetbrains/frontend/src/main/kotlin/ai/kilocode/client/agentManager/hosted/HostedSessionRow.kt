package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.agentManager.sessionRowTitle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.history.HostedHistoryItem
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.client.ui.active.ActiveCell
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.list.ActiveSection

internal class HostedSessionRow(
    private val item: HostedHistoryItem,
    private val kind: SessionActivityKind?,
    private val live: String?,
    private val closed: Boolean,
    private val toggle: (HostedHistoryItem) -> Unit,
) : ActiveSection {
    override val key: String get() = item.id
    override val title: String
        get() = sessionRowTitle(live, item.title, KiloBundle.message("hosted.workspace.session.untitled"))
    override val note: String? get() = if (closed) KiloBundle.message("hosted.workspace.session.closed") else null
    override val tooltip: String get() = title
    override val section: String get() = HistoryTime.title(HistoryTime.section(item))
    override val badges: List<ActiveBadge>
        get() = listOfNotNull(kind?.let { ActiveBadge(it.label(), it.style()) })
    override val cells: List<ActiveCell>
        get() = listOf(
            ActiveCell(
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
