package ai.kilocode.client.session.views.todo

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import javax.swing.BoxLayout
import javax.swing.JPanel

class TodoListPanel(
    todos: List<TodoDto> = emptyList(),
    private var before: Int = 0,
    private var after: Int = 0,
) : JPanel() {

    private var items = todos
    private var style = SessionEditorStyle.current()
    private val rows = mutableListOf<Row>()
    private val prior = JBLabel()
    private val later = JBLabel()

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.md())
        add(prior)
        add(later)
        applyStyle(style)
        sync()
    }

    fun update(todos: List<TodoDto>, hiddenBefore: Int = 0, hiddenAfter: Int = 0) {
        val size = todos.size != items.size
        items = todos
        before = hiddenBefore
        after = hiddenAfter
        if (size) sync()
        rows.forEachIndexed { index, row -> row.update(items[index], style) }
        syncHidden()
        revalidate()
        repaint()
    }

    fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        prior.font = style.smallFont
        later.font = style.smallFont
        prior.foreground = UiStyle.Colors.weak()
        later.foreground = UiStyle.Colors.weak()
        rows.forEachIndexed { index, row -> row.update(items[index], style) }
        syncHidden()
    }

    internal fun rowCount() = rows.size

    internal fun rowText(index: Int) = rows[index].text.text

    internal fun rowChecked(index: Int) = rows[index].check.isSelected

    internal fun rowCheckboxOpaque(index: Int) = rows[index].check.isOpaque

    internal fun rowFont(index: Int) = rows[index].text.font

    internal fun rowForeground(index: Int) = rows[index].text.foreground

    internal fun hiddenText() = listOf(prior, later).filter { it.isVisible }.joinToString(" ") { it.text }

    private fun sync() {
        removeAll()
        rows.clear()
        add(prior)
        items.forEach { todo ->
            val row = Row(todo, style)
            rows.add(row)
            add(row.panel)
        }
        add(later)
        syncHidden()
    }

    private fun syncHidden() {
        prior.text = hidden(before, true)
        prior.isVisible = before > 0
        later.text = hidden(after, false)
        later.isVisible = after > 0
    }

    private fun hidden(count: Int, earlier: Boolean): String {
        if (count <= 0) return ""
        val key = when {
            earlier && count == 1 -> "session.part.todo.hidden.earlier.one"
            earlier -> "session.part.todo.hidden.earlier.many"
            count == 1 -> "session.part.todo.hidden.later.one"
            else -> "session.part.todo.hidden.later.many"
        }
        return KiloBundle.message(key, count)
    }

    private class Row(todo: TodoDto, style: SessionEditorStyle) {
        val check = JBCheckBox().apply {
            isFocusable = false
            isEnabled = false
            isOpaque = false
        }
        val text = JBLabel()
        val panel = JPanel(BorderLayout(UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            border = JBUI.Borders.empty(UiStyle.Gap.xs(), 0)
            add(check, BorderLayout.WEST)
            add(text, BorderLayout.CENTER)
        }

        init {
            update(todo, style)
        }

        fun update(todo: TodoDto, style: SessionEditorStyle) {
            val done = todo.status == "completed"
            check.isSelected = done
            text.text = label(todo.content, done)
            text.font = if (todo.changed) style.boldFont else style.regularFont
            text.foreground = when {
                !done -> style.editorForeground
                todo.changed -> style.editorForeground
                else -> UiStyle.Colors.weak()
            }
        }

        private fun label(value: String, done: Boolean): String {
            val text = XmlStringUtil.escapeString(value)
            if (!done) return "<html>$text</html>"
            return "<html><s>$text</s></html>"
        }
    }
}
