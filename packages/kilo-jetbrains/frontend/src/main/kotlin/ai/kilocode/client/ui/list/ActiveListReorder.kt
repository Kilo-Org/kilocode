package ai.kilocode.client.ui.list

import com.intellij.ide.dnd.DnDDragStartBean
import com.intellij.ide.dnd.DnDImage
import com.intellij.ide.dnd.DnDSupport
import com.intellij.ide.dnd.SmoothAutoScroller
import com.intellij.ui.components.JBList
import java.awt.GraphicsEnvironment
import java.awt.Point
import javax.swing.JList
import javax.swing.TransferHandler

internal class ActiveListReorder(
    val movable: (ActiveListItem) -> Boolean = { true },
    val onMove: (ActiveListMove) -> Unit,
)

internal data class ActiveListMove(
    val key: String,
    val from: Int,
    val to: Int,
    val keys: List<String>,
)

internal data class ActiveListGap(
    val source: ActiveListItem,
    val height: Int,
) : ActiveListItem {
    override val key: String get() = source.key
    // Carry the dragged row's identity so a refresh mid-drag reselects the placeholder instead of
    // dropping the selection: rows whose identity differs from their key (worktrees) would not match.
    override val identity: Any get() = source.identity
    override val title: String get() = ""
    override val section: String? get() = source.section
    override val disabled: Boolean get() = true
}

internal fun activeListGapRows(rows: List<ActiveListItem>, key: String, index: Int, height: Int): List<ActiveListItem> {
    val from = rows.indexOfFirst { it.key == key }
    if (from < 0) return rows
    val source = rows[from]
    val out = rows.toMutableList()
    out.removeAt(from)
    out.add(index.coerceIn(0, out.size), ActiveListGap(source, height))
    return out
}

internal fun activeListSectionRun(rows: List<ActiveListItem>, index: Int): IntRange {
    if (index !in rows.indices) return 0 until 0
    val section = rows[index].section
    val start = generateSequence(index) { it - 1 }.takeWhile { it >= 0 && rows[it].section == section }.last()
    val end = generateSequence(index) { it + 1 }.takeWhile { it < rows.size && rows[it].section == section }.last()
    return start..end
}

internal fun installActiveListReorder(view: ActiveListView, list: JBList<ActiveListItem>, reorder: ActiveListReorder) {
    if (GraphicsEnvironment.isHeadless()) return
    list.transferHandler = TransferHandler(null)
    list.dragEnabled = true
    SmoothAutoScroller.installDropTargetAsNecessary(list)
    DnDSupport.createBuilder(list)
        .setBeanProvider { info -> view.pickable(info.point)?.let { DnDDragStartBean(ActiveListPick(list, it)) } }
        .setImageProvider { info ->
            val pair = view.dragImage(info.point) ?: return@setImageProvider null
            DnDImage(pair.first, pair.second)
        }
        .setTargetChecker { event ->
            val pick = event.attachedObject as? ActiveListPick
            if (pick?.list !== list) {
                event.setDropPossible(false)
                return@setTargetChecker true
            }
            event.setDropPossible(true)
            view.over(pick.key, event.getPointOn(list))
            true
        }
        .setDropHandlerWithResult { event ->
            val pick = event.attachedObject as? ActiveListPick
            if (pick?.list !== list) return@setDropHandlerWithResult false
            view.drop()
            true
        }
        .setDropEndedCallback { view.cancel() }
        .install()
}

private data class ActiveListPick(val list: JList<*>, val key: String)
