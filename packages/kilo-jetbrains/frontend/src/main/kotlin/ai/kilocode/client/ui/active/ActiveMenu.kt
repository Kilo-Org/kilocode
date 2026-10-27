package ai.kilocode.client.ui.active

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.ide.DataManager
import javax.swing.JComponent

internal class ActiveMenu<T : Any>(
    private val key: DataKey<T>,
    val group: ActionGroup,
    private val element: (ActiveItem) -> T?,
    val place: String = ActionPlaces.POPUP,
    private val eligible: ((ActiveItem) -> Boolean)? = null,
) {
    fun available(item: ActiveItem): Boolean = (eligible?.invoke(item) ?: true) && element(item) != null

    fun context(anchor: JComponent, item: ActiveItem): DataContext {
        val data = element(item)
        val builder = SimpleDataContext.builder()
            .setParent(DataManager.getInstance().getDataContext(anchor))
        if (data != null) builder.add(key, data)
        return builder.build()
    }
}
