package ai.kilocode.client.ui.list

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.ide.DataManager
import javax.swing.JComponent

internal class ActiveListMenu<T : Any>(
    private val key: DataKey<T>,
    val group: ActionGroup,
    private val element: (ActiveListItem) -> T?,
    val place: String = ActionPlaces.POPUP,
    private val alternate: ActiveListMenu<*>? = null,
) {
    fun available(item: ActiveListItem): Boolean = element(item) != null || alternate?.available(item) == true

    fun context(anchor: JComponent, item: ActiveListItem): DataContext {
        val data = element(item)
        if (data == null && alternate?.available(item) == true) {
            return SimpleDataContext.builder().setParent(alternate.context(anchor, item)).addNull(key).build()
        }
        val builder = SimpleDataContext.builder()
            .setParent(DataManager.getInstance().getDataContext(anchor))
        if (data != null) builder.add(key, data)
        alternate?.key?.let { builder.addNull(it) }
        return builder.build()
    }
}
