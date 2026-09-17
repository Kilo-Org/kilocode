package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.TrackPanel
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.board.BoardResult
import ai.kilocode.client.session.views.board.BoardToolParser
import ai.kilocode.client.session.views.board.boardMarkdown
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

/**
 * Renders `board_post` / `board_read` shared-agent-board tool calls as a route/message card
 * instead of the generic [ToolView]'s raw JSON body. Falls back to [ToolView] while the tool is
 * pending/running, and whenever the output cannot be parsed by [BoardToolParser].
 */
class BoardToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
    private val footer: ToolApprovalFooter = ToolApprovalFooter(),
    private val bodyHolder: BoardBody = BoardBody(),
) : AbstractSessionPartView(parts.header, { bodyHolder.pane(selection) }, { footer }), ApprovalReasonTarget {

    companion object {
        fun canRender(content: Tool): Boolean =
            (content.name == "board_post" || content.name == "board_read") && BoardToolParser.parse(content) != null
    }

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private var disposed = false

    init {
        applyStyle(style)
        sync()
    }

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        applyBodyStyle()
        return true
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + expandedGap() + bodyMaxHeight() + footerHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        var changed = sync()
        changed = syncBody() || changed
        changed = syncApprovalReason(approvalReasonsVisible()) || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        val text = markdown()
        return popup("tool", item.name, text.isNotBlank()) {
            markdownPopupBody(style, text, foreground = bodyColor())
        }
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.smallEditorFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        changed = applyBodyStyle() || changed
        changed = footer.applyStyle(style) || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun syncApprovalReason(visible: Boolean): Boolean {
        val changed = footer.update(item, visible)
        if (changed) refresh()
        return changed
    }

    @RequiresEdt
    fun labelText(): String = listOf(parts.title.text, parts.sub.text, parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    @RequiresEdt
    fun markdown(): String = BoardToolParser.parse(item)?.let(::boardMarkdown).orEmpty()

    @RequiresEdt
    internal fun bodyVisible() = bodyHolder.scroll?.parent === this

    @RequiresEdt
    internal fun bodyCreated() = bodyHolder.scroll != null

    @RequiresEdt
    internal fun bodyMarkdownText(): String? = bodyHolder.md?.markdown()

    @RequiresEdt
    internal fun hasToggle(): Boolean = arrow.isVisible

    private fun sync(): Boolean {
        val result = BoardToolParser.parse(item)
        var changed = false
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, title(item)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setText(parts.sub, boardSubtitle(item, result)) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        changed = footer.update(item, approvalReasonsVisible()) || changed
        return changed
    }

    private fun syncBody(): Boolean {
        val view = bodyHolder.md ?: return false
        val value = markdown()
        if (view.markdown() == value) return false
        view.set(value)
        return true
    }

    private fun applyBodyStyle(): Boolean {
        val view = bodyHolder.md ?: return false
        if (!disposed) {
            Disposer.register(this, view)
            disposed = true
        }
        view.applyStyle(style)
        // Prose only (no code fences), so stay transparent and let the wrapping TrackPanel's
        // codeBlockBackground fill show through, matching the session UI background guideline.
        view.opaque = false
        view.font = style.regularFont
        view.foreground = bodyColor()
        return true
    }

    private fun bodyColor() = SessionUiStyle.Colors.foreground()

    private fun bodyMaxHeight(): Int {
        val pane = bodyHolder.scroll ?: return 0
        val height = pane.getFontMetrics(style.regularFont).height
        return height * SessionUiStyle.View.Tool.BODY_LINES + JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "BoardToolView#$contentId(${labelText()})"
}

/**
 * Lazily creates and caches the board card's markdown body, mirroring [ToolParts]'s lazy body
 * cache. Held as a constructor-parameter default (like [ToolParts]) rather than a member of
 * [BoardToolView] itself, because the body factory lambda passed to the [AbstractSessionPartView]
 * superclass constructor cannot reference `this` before the instance is initialized.
 */
class BoardBody {
    var scroll: JBScrollPane? = null
        private set
    var md: MdView? = null
        private set

    @RequiresEdt
    fun pane(selection: SessionSelection?): JBScrollPane {
        val existing = scroll
        if (existing != null) return existing
        val view = MdViewFactory.create(SessionEditorStyle.current(), selection)
        md = view
        val panel = TrackPanel().apply {
            background = SessionUiStyle.Colors.codeBlockBackground()
            border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.md())
            add(view.component, BorderLayout.CENTER)
        }
        val pane = JBScrollPane(panel).apply {
            border = JBUI.Borders.empty()
            background = SessionUiStyle.Colors.codeBlockBackground()
            viewport.background = SessionUiStyle.Colors.codeBlockBackground()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        scroll = pane
        return pane
    }
}

/** Message count for `board_read`; empty for `board_post`, whose title already names the recipient. */
private fun boardSubtitle(tool: Tool, result: BoardResult?): String {
    if (tool.name != "board_read") return ""
    return result?.messages?.size?.toString() ?: ""
}
