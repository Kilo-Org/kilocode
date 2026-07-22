package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.ui.EditorTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

/**
 * Renders write tools (edit/write/apply_patch) with a Read-style header — an "Edit" title and a
 * clickable file link — plus a diff-stat changes tag. The expandable body and the collapsed hover
 * popup both render the unified diff via the shared markdown code editor, which colors it as a diff.
 */
class EditToolView(
    tool: Tool,
    openFile: SessionFileOpener = { _, _ -> },
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool, openFile),
    private val body: ToolMarkdownBody = diffBody(selection),
) : SecondarySessionPartView(parts.header, { body.mount(tool) }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private val badge = DiffStatBadge(0, 0)

    init {
        body.parent = this
        parts.controls.add(badge)
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot, badge)
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { body.markdown() ?: editDiff(item) }
    }

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        body.applyStyle(style)
        return true
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + (body.panel()?.preferredSize?.height ?: 0)
        return Dimension(size.width, minOf(size.height, height))
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        var changed = if (!expandable()) collapse() else false
        changed = sync() || changed
        changed = syncBody() || changed
        if (changed) refresh()
    }

    @RequiresEdt
    fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    @RequiresEdt
    fun bodyText(): String = editDiff(item)
    @RequiresEdt
    fun hasToggle(): Boolean = arrow.isVisible
    @RequiresEdt
    fun diffStat(): Pair<Int, Int> = diffStat(item)
    @RequiresEdt
    internal fun badgeVisible() = badge.isVisible
    @RequiresEdt
    internal fun linkVisible() = parts.link.isVisible
    @RequiresEdt
    internal fun linkLabel() = parts.label
    @RequiresEdt
    internal fun linkHref() = parts.href
    @RequiresEdt
    internal fun openLink() = parts.openLink()
    @RequiresEdt
    internal fun bodyCreated() = body.created()
    @RequiresEdt
    internal fun bodyVisible() = body.attached(this)
    @RequiresEdt
    internal fun markdown() = body.markdown() ?: diffMarkdown(item)
    @RequiresEdt
    internal fun codeEditors(): List<EditorTextField> = body.codeEditors()

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        if (isExpanded()) return null
        val diff = editDiff(item).takeIf { it.isNotBlank() } ?: return null
        return HeaderPopupRequest(row, build = { buildPopupBody(diff) }) {
            Telemetry.send("Header Popup Shown", mapOf("surface" to "session", "tool" to "edit"))
        }
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        changed = setFont(parts.link, style.transcriptFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        changed = body.applyStyle(style) || changed
        if (changed) refresh()
    }

    private fun expandable(): Boolean =
        editDiff(item).isNotBlank() || output(item).isNotBlank() || !item.error.isNullOrBlank()

    private fun sync(): Boolean {
        val expand = expandable()
        var changed = false
        changed = syncExpandable(expand) || changed
        changed = setVisible(parts.state, !expand) || changed
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, title(item)) || changed
        changed = setFileTarget(parts, editPath(item), tail(editPath(item))) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setForeground(parts.link, UiStyle.Colors.fg()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        changed = syncBadge() || changed
        return changed
    }

    private fun syncBadge(): Boolean {
        val (added, removed) = diffStat(item)
        val show = added > 0 || removed > 0
        val changed = setVisible(badge, show)
        if (show) badge.update(added, removed)
        return changed
    }

    private fun syncBody(): Boolean = body.update(item)

    @RequiresEdt
    private fun buildPopupBody(diff: String): HeaderPopupBody {
        val md = MdViewFactory.create(
            style,
            null,
            MdCodeBlockFactory.default(
                MdCodeBlockOptions(
                    border = MdCodeBlockBorder.None,
                    verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                    editorOnly = true,
                ),
            ),
        )
        md.applyStyle(style)
        md.font = style.editorFont
        md.foreground = style.editorForeground
        md.background = style.editorBackground
        md.preBg = style.editorBackground
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        md.set(patchMarkdown(diff))
        return HeaderPopupBody(md.component, md, style.editorBackground)
    }

    override fun dumpLabel() = "EditToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool) = tool.kind == ToolKind.WRITE
    }
}

private fun diffBody(selection: SessionSelection?) = ToolMarkdownBody(
    MdCodeBlockOptions(
        border = MdCodeBlockBorder.Bottom,
        maxLines = SessionUiStyle.View.Tool.DIFF_LINES,
        verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
        editorOnly = true,
    ),
    selection,
    render = ::diffMarkdown,
)

/** Diff body markdown: the unified patch when present, otherwise the tool output/error. */
@RequiresEdt
internal fun diffMarkdown(tool: Tool): String {
    val diff = editDiff(tool)
    if (diff.isNotBlank()) return patchMarkdown(diff)
    val body = plainBody(tool)
    if (body.isBlank()) return ""
    val fence = fence(body)
    return buildString {
        append(fence).append('\n')
        append(body)
        if (!body.endsWith('\n')) append('\n')
        append(fence)
    }
}
