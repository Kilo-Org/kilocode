package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.todo.TodoListPanel
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

/**
 * Collapsible to-do strip: "N/M todos complete" with a disclosure arrow, expanding into the full
 * [TodoListPanel]. Extracted from [SessionHeaderPanel] so both strips share identical chrome — see
 * [Strip].
 */
class TodoStrip : Strip() {

    private val list = TodoListPanel()
    private var items: List<TodoDto> = emptyList()

    init {
        summary.toolTipText = KiloBundle.message("session.header.todos.toggle")
        summary.accessibleContext.accessibleName = KiloBundle.message("session.header.todos.toggle")
    }

    override fun createBody(): JComponent = list

    @RequiresEdt
    fun update(items: List<TodoDto>) {
        this.items = items
        val done = items.count { it.status == "completed" }
        set(label, todo(done, items.size))
        syncColor()
        list.update(items)
        syncVisible(items.isNotEmpty())
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        super.applyStyle(style)
        syncColor()
        list.applyStyle(style)
    }

    private fun syncColor() {
        val done = items.count { it.status == "completed" }
        label.foreground = if (items.isNotEmpty() && done == items.size) {
            SessionUiStyle.Timeline.SUCCESS
        } else {
            style.editorForeground
        }
    }

    // ------ test accessors ------

    internal fun rowCount() = list.rowCount()
    internal fun rowText(index: Int) = list.rowText(index)
    internal fun rowChecked(index: Int) = list.rowChecked(index)
}
