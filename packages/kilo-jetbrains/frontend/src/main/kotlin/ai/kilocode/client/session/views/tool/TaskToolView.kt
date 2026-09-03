package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionCodeScroll
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.HeaderOpenAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.SwingUtilities
import kotlin.math.abs

class TaskToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val onOpenSubagent: ((String, String) -> Unit)? = null,
    private val parts: ToolParts = toolParts(tool),
    private val footer: ToolApprovalFooter = ToolApprovalFooter(),
) : AbstractSessionPartView(parts.header, { TaskBody(parts.glyph).scroll }, { footer }), UiDataProvider, ApprovalReasonTarget, SessionCopyTarget {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private val rows = LinkedHashMap<String, Row>()
    private var following = false
    private var collapsed = false
    private var popup: HeaderPopupBody? = null
    // Same hover open-in-editor affordance as the edit/patch and modified-files cards.
    private val open = HeaderOpenAction(
        SessionViewIcons.openDiff,
        KiloBundle.message("session.part.tool.openSubagent"),
        ::openSubagent,
    )

    init {
        // Mirror the edit/patch cards: move the summary and the open action into the non-fit left
        // group so the anchor always reserves its width right after the text. Left in the fill slot
        // (a fitHorizontal stack), a long summary would clip the trailing anchor to zero width and
        // the hover open control could fail to appear.
        parts.header.left(parts.sub, open.anchor)
        applyStyle(style)
        sync()
        if (item.childTools.isNotEmpty()) expand()
    }

    override val copyEligible: Boolean get() = item.childSessionId != null && onOpenSubagent != null
    override val copyAnchor: JComponent get() = open.anchor
    override val copyToolbar: JComponent get() = open.button

    override fun copyText(): String? = null

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { copyDump() }
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        val fresh = item.childTools.isEmpty() && content.childTools.isNotEmpty()
        item = content
        val follow = tailVisible()
        var changed = sync()
        changed = syncRows() || changed
        changed = syncApprovalReason(approvalReasonsVisible()) || changed
        if (content.childTools.isNotEmpty() && !collapsed) changed = expand() || changed
        followTail(follow || fresh)
        if (changed) {
            refresh()
            refreshPopup()
        }
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
        changed = footer.applyStyle(style) || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + expandedGap() + bodyMaxHeight() + footerHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    @RequiresEdt
    override fun syncApprovalReason(visible: Boolean): Boolean {
        val changed = footer.update(item, visible)
        if (changed) refresh()
        return changed
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
        changed = footer.update(item, approvalReasonsVisible()) || changed
        return changed
    }

    private fun openSubagent() {
        val id = item.childSessionId ?: return
        val title = listOf(agentTitle(item), summary(item)).filter { it.isNotBlank() }.joinToString(" - ")
        onOpenSubagent?.invoke(id, title)
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
            body.revalidate()
            body.repaint()
        }
        return changed
    }

    /**
     * Collapsed-card hover preview. Unlike the edit/patch popups, which build fresh snapshot content,
     * this hosts the *live* [TaskBodyScroll] — the same instance the in-place expanded card uses — so
     * streaming child tools keep updating inside the popup while the card stays collapsed.
     */
    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? =
        popup("tool", "task", item.childTools.isNotEmpty()) { taskPopupBody() }

    @RequiresEdt
    private fun taskPopupBody(): HeaderPopupBody {
        val scroll = taskBody()
        syncRows()
        val owner = Disposer.newDisposable("Task popup body")
        // The live body is only reparented into the popup, never rebuilt. On hide, detach it so it
        // returns to a reusable state — unless the card already reclaimed it by expanding — and never
        // dispose the shared component itself.
        val body = HeaderPopupBody(
            scroll,
            owner,
            SessionUiStyle.Colors.codeBlockBackground(),
            SessionUiStyle.View.Popup.WIDE_MAX_WIDTH,
            // Fixed, bounded box so streaming child tools scroll instead of resizing the balloon:
            // a 60-char floor width, the shared height cap, and both scrollbars.
            minWidth = scroll.getFontMetrics(style.smallEditorFont).charWidth('m') * POPUP_MIN_CHARS,
            fixedHeight = true,
            horizontal = true,
        )
        popup = body
        Disposer.register(owner, Disposable {
            if (popup === body) popup = null
            if (!isExpanded()) detachBody(scroll)
        })
        return body
    }

    // The popup hosts the live body, so parent-view updates just revalidate it for the scrollbars to
    // track the new content height; the balloon keeps its bounded size instead of resizing.
    @RequiresEdt
    private fun refreshPopup() {
        val body = popup ?: return
        body.component.revalidate()
        body.component.repaint()
    }

    @RequiresEdt
    private fun detachBody(scroll: TaskBodyScroll) {
        val parent = scroll.parent ?: return
        parent.remove(scroll)
        parent.revalidate()
        parent.repaint()
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

    private fun copyDump(): String = buildString {
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
        val sub = JBLabel().apply { foreground = SessionUiStyle.Text.Secondary.foreground() }
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
        private const val POPUP_MIN_CHARS = 60
        fun canRender(content: Tool): Boolean = content.name == "task"
    }
}

private class TaskBody(glyph: JBLabel) {
    val rows = TaskRows()
    val panel = object : JPanel(BorderLayout()) {
        override fun updateUI() {
            super.updateUI()
            background = SessionUiStyle.Colors.codeBlockBackground()
            border = taskBodyBorder(glyph)
        }
    }.apply {
        add(rows, BorderLayout.CENTER)
    }
    val scroll = TaskBodyScroll(this)
}

private class TaskBodyScroll(val body: TaskBody) : SessionCodeScroll(body.panel) {
    val rows: Stack get() = body.rows
    val panel: JPanel get() = body.panel

    init {
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.empty()
        viewport?.background = SessionUiStyle.Colors.codeBlockBackground()
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

    // super height is already scaled px; a JBDimension would scale it again under IDE zoom.
    override fun getMaximumSize() = Dimension(Int.MAX_VALUE, super.getMaximumSize().height)
}

private fun rowTitleColor(tool: Tool) = if (tool.state == ToolExecState.ERROR) {
    UiStyle.Colors.errorLabelForeground()
} else {
    SessionUiStyle.Text.Secondary.foreground()
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
