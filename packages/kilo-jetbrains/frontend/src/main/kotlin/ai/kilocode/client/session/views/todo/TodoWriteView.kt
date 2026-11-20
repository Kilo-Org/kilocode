package ai.kilocode.client.session.views.todo

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.tool.ApprovalReasonTarget
import ai.kilocode.client.session.views.tool.ToolApprovalFooter
import ai.kilocode.client.session.views.tool.approvalReasonsVisible
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Font
import javax.swing.JComponent

class TodoWriteView(
    tool: Tool,
    private val parts: TodoParts = todoParts(),
    private val footer: ToolApprovalFooter = ToolApprovalFooter(),
) : AbstractSessionPartView(parts.header, { parts.list }, { footer }, expanded = true), ApprovalReasonTarget {

    override val contentId = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        // Transparent list body: the base separates it from the header with the standard gap, so no
        // separator line is drawn here — only the content padding remains.
        parts.list.border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad())
        applyStyle(style)
        sync()
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        sync()
    }

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        val data = rows(item)
        val present = data.todos.isNotEmpty() || data.before > 0 || data.after > 0
        return popup("part", "todo", present) { buildPopup(data) }
    }

    @RequiresEdt
    private fun buildPopup(data: Rows) = componentPopupBody(
        TodoListPanel(data.todos, data.before, data.after).apply {
            border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad())
            applyStyle(style)
        },
    )

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        parts.list.applyStyle(style)
        changed = footer.applyStyle(style) || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun syncApprovalReason(visible: Boolean): Boolean {
        val changed = footer.update(item, visible)
        if (changed) refresh()
        return changed
    }

    fun labelText(): String = listOf(parts.title.text, parts.sub.text).filter { it.isNotBlank() }.joinToString(" ")
    internal fun rowCount() = parts.list.rowCount()
    internal fun rowText(index: Int) = parts.list.rowText(index)
    internal fun rowChecked(index: Int) = parts.list.rowChecked(index)
    internal fun rowCheckBackground(index: Int) = parts.list.rowCheckBackground(index)
    internal fun rowCheckForeground(index: Int) = parts.list.rowCheckForeground(index)
    internal fun rowCheckBorder(index: Int) = parts.list.rowCheckBorder(index)
    internal fun rowCheckAccessibleName(index: Int) = parts.list.rowCheckAccessibleName(index)
    internal fun rowFont(index: Int) = parts.list.rowFont(index)
    internal fun rowForeground(index: Int) = parts.list.rowForeground(index)
    internal fun hiddenText() = parts.list.hiddenText()
    internal fun titleFont() = parts.title.font
    internal fun subtitleFont() = parts.sub.font

    override fun dumpLabel() = "TodoWriteView#$contentId(${labelText()})"

    private fun sync() {
        parts.sub.text = subtitle(item)
        val data = rows(item)
        parts.list.update(
            data.todos,
            hiddenBefore = data.before,
            hiddenAfter = data.after,
        )
        footer.update(item, approvalReasonsVisible())
        syncExpandable(true)
        refresh()
    }

    companion object {
        fun canRender(tool: Tool) = tool.name == "todowrite" && tool.state == ToolExecState.COMPLETED
    }
}

class TodoParts(
    val header: PartHeader,
    val glyph: JBLabel,
    val title: JBLabel,
    val sub: JBLabel,
    val left: Stack,
    val right: Stack,
    val list: TodoListPanel,
)

private fun todoParts(): TodoParts {
    val glyph = JBLabel(SessionViewIcons.checklist)
    val title = JBLabel(KiloBundle.message("session.part.todo.title"))
    val sub = JBLabel().apply { foreground = SessionUiStyle.Text.Secondary.foreground() }
    val header = PartHeader().apply {
        leading(glyph)
        left(title)
        titleGap()
        left(sub)
    }
    return TodoParts(header, glyph, title, sub, header.left, header.right, TodoListPanel())
}

private fun subtitle(tool: Tool): String {
    val total = tool.todos.size
    if (total == 0) return ""
    val done = tool.todos.count { it.status == "completed" }
    return "$done/$total"
}

private data class Rows(val todos: List<TodoDto>, val before: Int, val after: Int)

private fun rows(tool: Tool): Rows {
    val view = tool.todoView
    if (view?.mode == "compact") return Rows(view.todos, view.hiddenBefore, view.hiddenAfter)
    return Rows(tool.todos, 0, 0)
}

private fun setFont(component: JComponent, font: Font): Boolean {
    if (component.font == font) return false
    component.font = font
    return true
}
