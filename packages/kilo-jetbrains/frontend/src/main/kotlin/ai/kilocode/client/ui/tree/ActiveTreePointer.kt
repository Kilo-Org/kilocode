package ai.kilocode.client.ui.tree

import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import java.awt.event.MouseEvent
import javax.swing.tree.TreePath

/** Press/release pairing must survive renderer reuse but never a geometry invalidation. */
internal class ActiveTreePointer(private val view: ActiveTreeView, private val actions: ActiveTreeActions) {
    private data class Press(val key: String, val id: String)
    private var press: Press? = null
    private var disclosure = false

    fun clear() {
        press = null
        disclosure = false
    }

    @RequiresEdt
    fun process(event: MouseEvent): Boolean {
        if (disclosure && (event.id == MouseEvent.MOUSE_RELEASED || event.id == MouseEvent.MOUSE_CLICKED)) {
            if (event.id == MouseEvent.MOUSE_CLICKED) disclosure = false
            return true
        }
        return when (event.id) {
            MouseEvent.MOUSE_PRESSED -> pressed(event)
            MouseEvent.MOUSE_RELEASED -> released(event)
            MouseEvent.MOUSE_CLICKED -> clicked(event)
            else -> false
        }
    }

    @RequiresEdt
    private fun pressed(event: MouseEvent): Boolean {
        return if (event.isPopupTrigger || event.button == MouseEvent.BUTTON3) view.showMenu(event.point, true)
        else if (UIUtil.isActionClick(event, MouseEvent.MOUSE_PRESSED, true)) {
            view.requestFocusInWindow()
            clear()
            val menu = view.showMenu(event.point)
            if (!menu) remember(event)
            menu || press != null
        } else false
    }

    private fun remember(event: MouseEvent) {
        val hit = view.regions.hit(event, true)
        press = hit?.id?.let { Press(hit.entry.key, it) }
    }

    @RequiresEdt
    private fun released(event: MouseEvent): Boolean {
        val down = press
        clear()
        val hit = view.regions.hit(event, true)
        val match = down != null && hit?.id == down.id && hit.entry.key == down.key
        val actionable = UIUtil.isActionClick(event, MouseEvent.MOUSE_RELEASED, true) &&
            hit?.entry?.item?.progress == null
        if (match && actionable) view.fire(hit.entry.item, down.id)
        return match && actionable
    }

    @RequiresEdt
    private fun clicked(event: MouseEvent): Boolean {
        val hit = view.regions.hit(event, false)
        if (!UIUtil.isActionClick(event, MouseEvent.MOUSE_CLICKED, true) || hit == null) return false
        return if (hit.id == null) {
            val entry = hit.entry
            val actionable = !entry.allowsChildren && entry.item.progress == null && event.clickCount in 1..2
            if (actionable) {
                view.selectionModel.selectionPath = TreePath(entry.path)
                if (event.clickCount == 1 && !actions.openOnClick) actions.click?.invoke(entry.item)
                else view.open(entry.item, event.clickCount == 2)
            }
            actionable
        } else true
    }

    @RequiresEdt
    fun headless(event: MouseEvent) {
        if (event.button != MouseEvent.BUTTON1) return
        val entry = view.regions.entry(event.point) ?: return
        val path = TreePath(entry.path)
        when {
            event.id == MouseEvent.MOUSE_PRESSED && view.regions.control(entry)?.contains(event.point) == true -> {
                disclosure = true
                if (view.isExpanded(path)) view.collapsePath(path) else view.expandPath(path)
            }
            event.id == MouseEvent.MOUSE_PRESSED ||
                (event.id == MouseEvent.MOUSE_CLICKED && event.clickCount == 1) ->
                view.selectionModel.selectionPath = path
            event.id == MouseEvent.MOUSE_CLICKED && event.clickCount == 2 && entry.allowsChildren -> {
                if (view.isExpanded(path)) view.collapsePath(path) else view.expandPath(path)
            }
        }
    }
}
