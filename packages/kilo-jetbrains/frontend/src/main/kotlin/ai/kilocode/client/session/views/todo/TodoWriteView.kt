package ai.kilocode.client.session.views.todo

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PrimarySessionPartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Font
import javax.swing.Box
import javax.swing.JComponent
import javax.swing.JPanel

class TodoWriteView(tool: Tool, private val parts: TodoParts = todoParts()) :
    PrimarySessionPartView(parts.header, parts.list, expanded = true) {

    override val contentId = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        bindHeader(parts.glyph, parts.title, parts.sub, parts.center, parts.controls)
        parts.list.border = JBUI.Borders.compound(
            SessionUiStyle.View.topOutline(),
            JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.md()),
        )
        applyStyle(style)
        sync()
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        sync()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        parts.list.applyStyle(style)
        if (changed) refresh()
    }

    fun labelText(): String = listOf(parts.title.text, parts.sub.text).filter { it.isNotBlank() }.joinToString(" ")
    internal fun rowCount() = parts.list.rowCount()
    internal fun rowText(index: Int) = parts.list.rowText(index)
    internal fun rowChecked(index: Int) = parts.list.rowChecked(index)
    internal fun rowCheckboxOpaque(index: Int) = parts.list.rowCheckboxOpaque(index)
    internal fun rowForeground(index: Int) = parts.list.rowForeground(index)
    internal fun hiddenText() = parts.list.hiddenText()
    internal fun titleFont() = parts.title.font
    internal fun subtitleFont() = parts.sub.font

    override fun dumpLabel() = "TodoWriteView#$contentId(${labelText()})"

    private fun sync() {
        parts.sub.text = subtitle(item)
        val view = item.todoView
        val compact = view?.mode == "compact"
        val rows = if (compact) view.todos else item.todos
        parts.list.update(
            rows,
            hiddenBefore = if (compact) view.hiddenBefore else 0,
            hiddenAfter = if (compact) view.hiddenAfter else 0,
        )
        syncExpandable(true)
        refresh()
    }

    companion object {
        fun canRender(tool: Tool) = tool.name == "todowrite" && tool.state == ToolExecState.COMPLETED
    }
}

class TodoParts(
    val header: JPanel,
    val glyph: JBLabel,
    val title: JBLabel,
    val sub: JBLabel,
    val center: JPanel,
    val controls: JComponent,
    val list: TodoListPanel,
)

private fun todoParts(): TodoParts {
    val glyph = JBLabel(AllIcons.Actions.Checked)
    val title = JBLabel(KiloBundle.message("session.part.todo.title"))
    val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val center = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0)).apply {
        isOpaque = false
        add(title, BorderLayout.WEST)
        add(sub, BorderLayout.CENTER)
    }
    val controls = Box.createHorizontalBox()
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0)).apply {
        isOpaque = false
        add(glyph, BorderLayout.WEST)
        add(center, BorderLayout.CENTER)
        add(controls, BorderLayout.EAST)
    }
    return TodoParts(header, glyph, title, sub, center, controls, TodoListPanel())
}

private fun subtitle(tool: Tool): String {
    val total = tool.todos.size
    if (total == 0) return ""
    val done = tool.todos.count { it.status == "completed" }
    return "$done/$total"
}

private fun setFont(component: JComponent, font: Font): Boolean {
    if (component.font == font) return false
    component.font = font
    return true
}
