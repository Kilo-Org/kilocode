package ai.kilocode.client.session.history

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.ui.components.JBList
import java.awt.event.MouseEvent

internal fun title(item: HistoryItem): String = item.title.takeIf { it.isNotBlank() } ?: KiloBundle.message("history.untitled")

internal fun <T> itemAt(list: JBList<T>, e: MouseEvent): T? {
    val row = list.locationToIndex(e.point)
    val box = row.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return null
    if (!box.contains(e.point)) return null
    return list.model.getElementAt(row)
}
