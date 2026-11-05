package ai.kilocode.client.ui.active

import com.intellij.util.concurrency.annotations.RequiresEdt

/** Resolve against the current payload, never the retained renderer stamp. */
@RequiresEdt
internal fun activeDispatch(item: ActiveItem, id: String, fallback: (String, String) -> Unit) {
    val action = item.cells.firstOrNull { it.id == id }?.action ?: activeRegions(item)[id]
    if (action != null) action() else fallback(item.key, id)
}
