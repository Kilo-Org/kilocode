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
) {
    fun available(item: ActiveListItem): Boolean = element(item) != null

    fun context(anchor: JComponent, item: ActiveListItem): DataContext {
        val data = element(item)
        val builder = SimpleDataContext.builder()
            .setParent(DataManager.getInstance().getDataContext(anchor))
        if (data != null) builder.add(key, data)
        return builder.build()
    }
}
