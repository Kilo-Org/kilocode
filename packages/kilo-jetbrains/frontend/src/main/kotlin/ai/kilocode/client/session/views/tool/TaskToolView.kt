package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.SwingUtilities
import kotlin.math.abs

class TaskToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
) : SecondarySessionPartView(parts.header, { TaskBody(parts.glyph).scroll }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private val rows = LinkedHashMap<String, Row>()
    private var following = false
    private var collapsed = false

    init {
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        applyStyle(style)
        sync()
        if (item.childTools.isNotEmpty()) expand()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { copyText() }
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        val fresh = item.childTools.isEmpty() && content.childTools.isNotEmpty()
        item = content
        val follow = tailVisible()
        var changed = sync()
        changed = syncRows() || changed
        if (content.childTools.isNotEmpty() && !collapsed) changed = expand() || changed
        followTail(follow || fresh)
        if (changed) refresh()
    }

    @RequiresEdt
    override fun expand(): Boolean {
        collapsed = false
        val changed = super.expand()
        syncRows()
        return changed
    }

    @RequiresEdt
    override fun collapse(): Boolean {
        if (item.childTools.isNotEmpty() && isExpanded()) collapsed = true
        return super.collapse()
    }

    @RequiresEdt
    private fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    @RequiresEdt
    private fun bodyVisible(): Boolean = isExpanded()

    @RequiresEdt
    private fun bodyMaxRows() = SessionUiStyle.View.Tool.TASK_LINES

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.smallEditorFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        for (row in rows.values) changed = row.applyStyle(style) || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    private fun sync(): Boolean {
        var changed = false
        changed = syncExpandable(item.childTools.isNotEmpty()) || changed
        changed = setVisible(parts.state, item.childTools.isEmpty()) || changed
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, agentTitle(item)) || changed
        changed = setText(parts.sub, summary(item)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        return changed
    }

    private fun syncRows(): Boolean {
        if (!hasBody()) return false
        val body = taskBody()
        var changed = false
        val ids = item.childTools.map { tool -> tool.id }.toSet()
        val stale = rows.keys.filter { id -> id !in ids }
        for (id in stale) {
            val row = rows.remove(id) ?: continue
            body.rows.remove(row.panel)
            changed = true
        }
        for (tool in item.childTools) {
            val row = rows[tool.id]
            if (row == null) {
                val next = Row(tool).also { it.applyStyle(style) }
                rows[tool.id] = next
                body.rows.next(next.panel)
                changed = true
                continue
            }
            changed = row.update(tool) || changed
        }
        if (changed) {
            body.rows.revalidate()
            body.rows.repaint()
        }
        return changed
    }

    private fun taskBody() = bodyComponent() as TaskBodyScroll

    private fun taskBodyOrNull() = if (hasBody()) bodyComponent() as? TaskBodyScroll else null

    private fun bodyMaxHeight(): Int {
        val body = taskBodyOrNull() ?: return 0
        val height = rows.values.firstOrNull()?.panel?.getFontMetrics(style.smallEditorFont)?.height
            ?: body.rows.getFontMetrics(style.smallEditorFont).height
        return height * bodyMaxRows() + JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    @RequiresEdt
    private fun tailVisible(): Boolean {
        if (!bodyVisible()) return false
        val scroll = taskBodyOrNull() ?: return false
        val bar = scroll.verticalScrollBar
        val bottom = bar.maximum - bar.visibleAmount
        return bottom > 0 && abs(bar.value - bottom) <= UiStyle.Gap.pad()
    }

    @RequiresEdt
    private fun followTail(follow: Boolean) {
        if (!follow || !bodyVisible() || following) return
        val scroll = taskBodyOrNull() ?: return
        following = true
        SwingUtilities.invokeLater { followPass(scroll, 4) }
    }

    @RequiresEdt
    private fun followPass(scroll: JBScrollPane, passes: Int) {
        if (!bodyVisible()) {
            following = false
            return
        }
        val view = scroll.viewport.view
        view?.setSize(scroll.viewport.extentSize.width.coerceAtLeast(1), view.preferredSize.height)
        view?.doLayout()
        scroll.viewport.doLayout()
        scroll.doLayout()
        scroll.viewport.viewPosition = Point(0, bottom(scroll))
        scroll.verticalScrollBar.value = bottom(scroll)
        if (passes <= 0 || scroll.verticalScrollBar.value == bottom(scroll)) {
            following = false
            return
        }
        SwingUtilities.invokeLater { followPass(scroll, passes - 1) }
    }

    private fun bottom(scroll: JBScrollPane): Int {
        val view = scroll.viewport.view ?: return 0
        return maxOf(0, view.height - scroll.viewport.extentSize.height)
    }

    private fun copyText(): String = buildString {
        append(agentTitle(item))
        val desc = item.input["description"].orEmpty()
        if (desc.isNotBlank()) append(" - ").append(desc)
        for (tool in item.childTools) {
            append('\n')
            append(title(tool))
            val sub = subtitle(tool)
            if (sub.isNotBlank()) append(' ').append(sub)
        }
    }

    private class Row(tool: Tool) {
        private var item = tool
        val icon = JBLabel()
        val title = JBLabel()
        val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
        val panel = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
            isOpaque = false
            add(icon, BorderLayout.WEST)
            add(JPanel(BorderLayout(UiStyle.Gap.sm(), 0)).apply {
                isOpaque = false
                add(title, BorderLayout.WEST)
                add(sub, BorderLayout.CENTER)
            }, BorderLayout.CENTER)
        }

        @RequiresEdt
        fun update(tool: Tool): Boolean {
            item = tool
            var changed = false
            changed = setIcon(icon, icon(tool)) || changed
            changed = setForeground(icon, color(tool)) || changed
            changed = setText(title, title(tool)) || changed
            changed = setForeground(title, rowTitleColor(tool)) || changed
            changed = setText(sub, subtitle(tool)) || changed
            return changed
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle): Boolean {
            var changed = false
            changed = setFont(title, style.boldEditorFont) || changed
            changed = setFont(sub, style.smallEditorFont) || changed
            return update(item) || changed
        }
    }

    override fun dumpLabel() = "TaskToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(content: Tool): Boolean = content.name == "task"
    }
}

private class TaskBody(glyph: JBLabel) {
    val rows = TaskRows()
    val panel = object : JPanel(BorderLayout()) {
        override fun updateUI() {
            super.updateUI()
            background = SessionUiStyle.View.Surface.bgColor()
            border = taskBodyBorder(glyph)
        }
    }.apply {
        add(rows, BorderLayout.CENTER)
    }
    val scroll = TaskBodyScroll(this)
}

private class TaskBodyScroll(val body: TaskBody) : JBScrollPane(body.panel) {
    val rows: Stack get() = body.rows
    val panel: JPanel get() = body.panel

    init {
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.empty()
        background = SessionUiStyle.View.Surface.bgColor()
        viewport?.background = SessionUiStyle.View.Surface.bgColor()
    }
}

private class TaskRows : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()), Scrollable {
    override fun getScrollableTracksViewportWidth() = true
    override fun getScrollableTracksViewportHeight() = false
    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize
    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT)
    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = visibleRect.height

    override fun getMaximumSize() = JBDimension(Int.MAX_VALUE, super.getMaximumSize().height)
}

private fun rowTitleColor(tool: Tool) = if (tool.state == ToolExecState.ERROR) {
    UiStyle.Colors.errorLabelForeground()
} else {
    UiStyle.Colors.weak()
}

private fun taskBodyBorder(glyph: JBLabel) = run {
    val width = maxOf(
        glyph.preferredSize.width,
        glyph.icon?.iconWidth ?: 0,
        JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
    )
    JBUI.Borders.empty(
        UiStyle.Gap.sm(),
        width + JBUI.scale(SessionUiStyle.View.Layout.GAP) + UiStyle.Gap.md(),
        UiStyle.Gap.sm(),
        UiStyle.Gap.md(),
    )
}

private fun agentTitle(tool: Tool): String {
    val type = tool.input["subagent_type"]?.takeIf { it.isNotBlank() } ?: tool.name
    return KiloBundle.message("session.part.tool.agent", type.replaceFirstChar { it.titlecase() })
}

private fun summary(tool: Tool): String {
    val desc = tool.input["description"].orEmpty()
    val count = tool.childTools.size
    if (count <= 0) return desc
    if (desc.isBlank()) return "($count)"
    return "$desc ($count)"
}
