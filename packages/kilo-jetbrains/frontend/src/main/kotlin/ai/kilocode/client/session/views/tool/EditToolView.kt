package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
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
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
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
    private val openFile: SessionFileOpener = { _, _ -> },
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool, openFile),
    private var body: EditBody = editBody(tool, selection, openFile),
) : SecondarySessionPartView(parts.header, { body.mount(tool) }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private var multi = editFiles(tool).size > 1
    private val badge = DiffStatBadge(0, 0)
    private val filesTag = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        font = JBFont.small()
        border = JBUI.Borders.emptyRight(SessionUiStyle.View.Layout.HORIZONTAL_PADDING)
        isVisible = false
    }

    init {
        body.parent = this
        parts.controls.add(filesTag)
        parts.controls.add(badge)
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot, filesTag, badge)
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { body.markdown() ?: diffMarkdown(item) }
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
        changed = swapBody() || changed
        changed = sync() || changed
        changed = syncBody() || changed
        if (changed) refresh()
    }

    /** Rebuild the body delegate when a streaming tool crosses the single/multi-file boundary. */
    @RequiresEdt
    private fun swapBody(): Boolean {
        val next = editFiles(item).size > 1
        if (next == multi) return false
        multi = next
        val expanded = isExpanded()
        discardBody()
        body.disposeBody()
        body = editBody(item, selection, openFile).also { it.parent = this }
        if (expanded) expand()
        return true
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
    internal fun filesTagVisible() = filesTag.isVisible
    @RequiresEdt
    internal fun filesTagText() = filesTag.text
    @RequiresEdt
    internal fun linkVisible() = parts.link.isVisible
    @RequiresEdt
    internal fun linkLabel() = parts.label
    @RequiresEdt
    internal fun linkHref() = parts.href
    @RequiresEdt
    internal fun linkTooltip() = parts.link.toolTipText
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
        if (editDiff(item).isBlank()) return null
        return HeaderPopupRequest(row, build = { buildPopupBody() }) {
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
        val count = editFiles(item).size
        val titleText = if (count > 1) KiloBundle.message("session.part.tool.patch") else title(item)
        changed = setText(parts.title, titleText) || changed
        val path = if (count > 1) null else editPath(item)
        changed = setFileTarget(parts, path, if (path == null) "" else tail(path)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setForeground(parts.link, UiStyle.Colors.fg()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        changed = syncFilesTag(count) || changed
        changed = syncBadge() || changed
        return changed
    }

    private fun syncFilesTag(count: Int): Boolean {
        val show = count > 1
        var changed = setVisible(filesTag, show)
        if (show) changed = setText(filesTag, KiloBundle.message("session.part.tool.edit.files", count)) || changed
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
    private fun buildPopupBody(): HeaderPopupBody {
        val owner = Disposer.newDisposable("Edit popup body")
        val popup = popupBody(item, selection, openFile).also { it.parent = owner }
        // mount() already renders the current item (ToolMarkdownBody.mount calls update; PatchBody.mount
        // calls rebuild and sets its signature), so a follow-up update() here would be a no-op.
        val panel = popup.mount(item)
        popup.applyStyle(style)
        return HeaderPopupBody(panel, owner, style.editorBackground, SessionUiStyle.View.Popup.WIDE_MAX_WIDTH)
    }

    override fun dumpLabel() = "EditToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool) = tool.kind == ToolKind.WRITE
    }
}

/** Picks the multi-file patch body for apply_patch spanning several files, else the single diff. */
private fun editBody(tool: Tool, selection: SessionSelection?, openFile: SessionFileOpener): EditBody =
    if (editFiles(tool).size > 1) PatchBody(selection, openFile) else diffBody(selection)

private fun popupBody(tool: Tool, selection: SessionSelection?, openFile: SessionFileOpener): EditBody =
    if (editFiles(tool).size > 1) PatchBody(selection, openFile, POPUP_OPTS) else popupDiffBody(selection)

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

private fun popupDiffBody(selection: SessionSelection?) = ToolMarkdownBody(
    POPUP_OPTS,
    selection,
    render = ::diffMarkdown,
)

private val POPUP_OPTS = MdCodeBlockOptions(
    border = MdCodeBlockBorder.None,
    verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
    editorOnly = true,
)

/**
 * Diff body markdown: per-file sections when an apply_patch touched multiple files, otherwise the
 * single unified patch, falling back to the tool output/error when no diff is available.
 */
@RequiresEdt
internal fun diffMarkdown(tool: Tool): String {
    val files = editFiles(tool)
    if (files.count { it.patch.isNotBlank() } > 1) return multiFileDiffMarkdown(files)
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
