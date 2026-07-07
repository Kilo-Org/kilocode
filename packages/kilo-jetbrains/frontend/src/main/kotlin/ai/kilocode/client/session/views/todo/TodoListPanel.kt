package ai.kilocode.client.session.views.todo

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import java.awt.BasicStroke
import java.awt.Color
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.Icon

class TodoListPanel(
    todos: List<TodoDto> = emptyList(),
    private var before: Int = 0,
    private var after: Int = 0,
) : Stack(StackAxis.VERTICAL) {

    private var items = todos
    private var style = SessionEditorStyle.current()
    private val rows = mutableListOf<Row>()
    private val prior = JBLabel()
    private val later = JBLabel()

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad())
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

    internal fun rowChecked(index: Int) = rows[index].icon.done

    internal fun rowCheckBackground(index: Int) = rows[index].icon.bg

    internal fun rowCheckForeground(index: Int) = rows[index].icon.fg

    internal fun rowCheckBorder(index: Int) = rows[index].icon.border

    internal fun rowCheckAccessibleName(index: Int) = rows[index].check.accessibleContext.accessibleName

    internal fun rowFont(index: Int) = rows[index].text.font

    internal fun rowForeground(index: Int) = rows[index].text.foreground

    internal fun hiddenText() = listOf(prior, later).filter { it.isVisible }.joinToString(" ") { it.text }

    private fun sync() {
        removeAll()
        rows.clear()
        next(prior)
        items.forEach { todo ->
            val row = Row(todo, style)
            rows.add(row)
            next(row.panel)
        }
        next(later)
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
        var icon = TodoCheckIcon(false)
            private set
        val check = JBLabel().apply {
            isFocusable = false
            icon = this@Row.icon
        }
        val text = JBLabel()
        val panel = Stack.horizontal(UiStyle.Gap.sm()).apply {
            border = JBUI.Borders.empty(UiStyle.Gap.xs(), 0)
            next(check)
            next(text)
        }

        init {
            update(todo, style)
        }

        fun update(todo: TodoDto, style: SessionEditorStyle) {
            val done = todo.status == "completed"
            syncIcon(done)
            check.accessibleContext.accessibleName = KiloBundle.message(accessible(done), todo.content)
            check.accessibleContext.accessibleDescription = check.accessibleContext.accessibleName
            text.text = label(todo.content, done)
            text.font = style.regularFont
            text.foreground = when {
                !done -> style.editorForeground
                else -> UiStyle.Colors.weak()
            }
        }

        private fun syncIcon(done: Boolean) {
            val bg = SessionUiStyle.View.Todo.checkBg()
            val fg = SessionUiStyle.View.Todo.checkFg()
            val border = SessionUiStyle.View.Todo.checkBorder()
            if (icon.done == done && icon.bg == bg && icon.fg == fg && icon.border == border) return
            icon = TodoCheckIcon(done, bg, fg, border)
            check.icon = icon
        }

        private fun label(value: String, done: Boolean): String {
            val text = XmlStringUtil.escapeString(value)
            if (!done) return "<html>$text</html>"
            return "<html><s>$text</s></html>"
        }

        private fun accessible(done: Boolean) = if (done) {
            "session.part.todo.accessible.completed"
        } else {
            "session.part.todo.accessible.pending"
        }
    }

    private class TodoCheckIcon(
        val done: Boolean,
        val bg: Color = SessionUiStyle.View.Todo.checkBg(),
        val fg: Color = SessionUiStyle.View.Todo.checkFg(),
        val border: Color = SessionUiStyle.View.Todo.checkBorder(),
    ) : Icon {
        override fun getIconWidth() = JBUI.scale(16)

        override fun getIconHeight() = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                val size = iconWidth - JBUI.scale(2)
                val inset = JBUI.scale(1)
                val arc = UiStyle.Gap.sm()
                g2.color = bg
                g2.fillRoundRect(inset, inset, size, size, arc, arc)
                g2.color = border
                g2.stroke = BasicStroke(JBUI.scale(1).toFloat())
                g2.drawRoundRect(inset, inset, size, size, arc, arc)
                if (!done) return
                g2.color = fg
                g2.stroke = BasicStroke(JBUI.scale(2).toFloat(), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND)
                g2.drawLine(JBUI.scale(5), JBUI.scale(8), JBUI.scale(7), JBUI.scale(10))
                g2.drawLine(JBUI.scale(7), JBUI.scale(10), JBUI.scale(11), JBUI.scale(6))
            } finally {
                g2.dispose()
            }
        }
    }
}
