package ai.kilocode.client.session.views.todo

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Box
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

class TodoWriteView(tool: Tool) : PartView() {

    override val contentId = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    private val root = JPanel(BorderLayout()).apply {
        isOpaque = true
        background = SessionUiStyle.View.surface()
        border = SessionUiStyle.View.card()
    }
    private val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP), 0)).apply {
        isOpaque = true
        background = SessionUiStyle.View.header()
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
        )
    }
    private val glyph = JBLabel(AllIcons.Actions.Checked)
    private val title = JBLabel(KiloBundle.message("session.part.todo.title"))
    private val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    private val arrow = JBLabel(AllIcons.General.ArrowDown)
    private val center = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP), 0)).apply {
        isOpaque = false
    }
    private val controls: JComponent = Box.createHorizontalBox().apply { add(arrow) }
    private val list = TodoListPanel()

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            toggle()
        }
    }
    private val mouse = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
            setHover(true)
        }

        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHover(false)
        }
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        center.add(title, BorderLayout.WEST)
        center.add(sub, BorderLayout.CENTER)
        header.add(glyph, BorderLayout.WEST)
        header.add(center, BorderLayout.CENTER)
        header.add(controls, BorderLayout.EAST)
        root.add(header, BorderLayout.NORTH)
        root.add(list, BorderLayout.CENTER)
        list.border = JBUI.Borders.compound(
            SessionUiStyle.View.cardTop(),
            JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.md()),
        )
        listOf(header, glyph, title, sub, arrow, center, controls).forEach {
            bind(it)
            it.addMouseListener(click)
        }
        applyStyle(style)
        add(root, BorderLayout.CENTER)
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
        changed = setFont(title, style.boldEditorFont) || changed
        changed = setFont(sub, style.transcriptFont) || changed
        list.applyStyle(style)
        if (changed) refresh()
    }

    fun toggle() {
        val changed = if (isExpanded()) detach() else attach()
        if (!changed) return
        syncArrow()
        refresh()
    }

    fun isExpanded() = list.parent === root

    fun labelText(): String = listOf(title.text, sub.text).filter { it.isNotBlank() }.joinToString(" ")

    internal fun rowCount() = list.rowCount()

    internal fun rowText(index: Int) = list.rowText(index)

    internal fun rowChecked(index: Int) = list.rowChecked(index)

    internal fun rowCheckboxOpaque(index: Int) = list.rowCheckboxOpaque(index)

    internal fun rowForeground(index: Int) = list.rowForeground(index)

    internal fun hiddenText() = list.hiddenText()

    internal fun titleFont() = title.font

    internal fun subtitleFont() = sub.font

    override fun dumpLabel() = "TodoWriteView#$contentId(${labelText()})"

    private fun sync() {
        sub.text = subtitle(item)
        val view = item.todoView
        val compact = view?.mode == "compact"
        val rows = if (compact) view.todos else item.todos
        list.update(
            rows,
            hiddenBefore = if (compact) view.hiddenBefore else 0,
            hiddenAfter = if (compact) view.hiddenAfter else 0,
        )
        syncArrow()
        refresh()
    }

    private fun attach(): Boolean {
        if (isExpanded()) return false
        root.add(list, BorderLayout.CENTER)
        return true
    }

    private fun detach(): Boolean {
        if (!isExpanded()) return false
        root.remove(list)
        return true
    }

    private fun syncArrow() {
        arrow.icon = if (isExpanded()) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
    }

    private fun setHover(value: Boolean) {
        val color = if (value) SessionUiStyle.View.headerHover() else SessionUiStyle.View.header()
        if (same(header.background, color)) return
        header.background = color
        header.repaint()
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, header)
        return header.contains(point)
    }

    private fun bind(component: Component) {
        component.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        component.addMouseListener(mouse)
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    companion object {
        fun canRender(tool: Tool) = tool.name == "todowrite" && tool.state == ToolExecState.COMPLETED
    }
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

private fun same(a: Color?, b: Color): Boolean = a?.rgb == b.rgb
