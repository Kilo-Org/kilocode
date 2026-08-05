package ai.kilocode.client.session.views.tool

import ai.kilocode.client.diff.DiffLineNumbers
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.hoverPlaceholder
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import java.awt.Dimension
import javax.swing.JComponent
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
) : SecondarySessionPartView(parts.header, { body.mount(tool) }), UiDataProvider, SessionCopyTarget {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private var kind = bodyKind(tool)
    private var opener: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var canDiff = false
    private val badge = DiffStatBadge(0, 0)
    private val diff = toolbarButton(
        ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("session.part.tool.openDiff"), ::openDiffViewer),
    )
    private val diffAnchor = hoverPlaceholder(diff)
    private val filesTag = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        font = JBFont.small()
        isVisible = false
    }

    init {
        body.parent = this
        body.overflow = ::openDiffViewer
        // Left-aligned header: icon, title, file name (single) or file count (multi), change badge, open-in-diff.
        parts.left.next(parts.link)
        parts.left.next(filesTag)
        parts.left.next(PartHeader.centered(badge))
        parts.left.next(PartHeader.centered(diffAnchor))
        // parts.link is intentionally omitted: FileLinkLabel installs its own click handler that opens
        // the file, and binding it here would also toggle the card on the same click (see ReadToolView,
        // which likewise omits it). Header toggling still works via parts.left/row.
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.left, parts.right, parts.slot, filesTag, badge, diffAnchor)
        applyStyle(style)
        sync()
    }

    override val copyEligible: Boolean get() = canDiff
    override val copyAnchor: JComponent get() = diffAnchor
    override val copyToolbar: JComponent get() = diff

    constructor(
        tool: Tool,
        openFile: SessionFileOpener,
        selection: SessionSelection?,
        openDiff: SessionDiffOpener,
        sessionId: String?,
    ) : this(tool, openFile, selection) {
        opener = openDiff
        this.sessionId = sessionId
    }

    /**
     * Late-bind the diff opener. The transcript builds this view before the session-level opener is
     * known, so [ai.kilocode.client.session.views.MessageView] rebinds it once the opener is wired.
     */
    @RequiresEdt
    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?) {
        opener = openDiff
        this.sessionId = sessionId
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { body.markdown() ?: diffMarkdown(item) }
    }

    override fun copyText(): String? = null

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

    /** Rebuild the body delegate when a streaming tool crosses a single/multi/overflow boundary. */
    @RequiresEdt
    private fun swapBody(): Boolean {
        val next = bodyKind(item)
        if (next == kind) return false
        kind = next
        val expanded = isExpanded()
        discardBody()
        body.disposeBody()
        body = editBody(item, selection, openFile).also {
            it.parent = this
            it.overflow = ::openDiffViewer
        }
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
        syncDiffAction(count)
        changed = syncFilesTag(count) || changed
        changed = syncBadge() || changed
        return changed
    }

    private fun syncDiffAction(count: Int) {
        // Mirrors toDiffFiles(item).isNotEmpty() without re-parsing the metadata JSON or allocating a
        // DiffFileDto per file on every streaming delta: files present, else a single-file patch.
        val show = count > 0 || editDiff(item).isNotBlank()
        if (canDiff == show && diff.isEnabled == show) return
        canDiff = show
        diff.isEnabled = show
    }

    private fun openDiffViewer() {
        val files = toDiffFiles(item)
        if (files.isEmpty()) return
        opener(files, diffTitle(item), "tool:${sessionId ?: "pending"}:${item.id}")
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
        val popup = popupBody(item, selection, openFile).also {
            it.parent = owner
            it.overflow = ::openDiffViewer
        }
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

private fun toDiffFiles(tool: Tool): List<DiffFileDto> {
    val files = editFiles(tool).map { DiffFileDto(it.path, it.additions, it.deletions, it.patch, it.type.ifBlank { null }) }
    if (files.isNotEmpty()) return files
    val patch = editDiff(tool)
    if (patch.isBlank()) return emptyList()
    val stat = diffStat(tool)
    return listOf(DiffFileDto(editPath(tool), stat.first, stat.second, patch))
}

private fun diffTitle(tool: Tool): String =
    // Keep the file name for a single-file edit so each per-tool diff tab is identifiable
    // (SessionUi decorates it into "<name> (branch)"); reserve the generic label for multi-file patches.
    if (editFiles(tool).size > 1) KiloBundle.message("session.part.tool.patch") else tail(editPath(tool))

/**
 * Which body to build for the current diff. [PatchBody] renders (and self-caps) multi-file patches;
 * [OverflowBody] shows the "open in a diff tab" placeholder for a single-file diff too large to
 * preview; [ToolMarkdownBody] renders a normal single-file diff. Multi-file overflow stays [PATCH]
 * because [PatchBody] caps itself internally.
 */
private enum class BodyKind { SINGLE, PATCH, OVERFLOW }

private fun bodyKind(tool: Tool): BodyKind {
    if (editFiles(tool).size > 1) return BodyKind.PATCH
    if (patchLineCount(editDiff(tool)) > SessionUiStyle.View.Tool.DIFF_MAX_LINES) return BodyKind.OVERFLOW
    return BodyKind.SINGLE
}

/** Picks the multi-file patch body, the large-diff placeholder, or the single-file diff. */
private fun editBody(tool: Tool, selection: SessionSelection?, openFile: SessionFileOpener): EditBody =
    when (bodyKind(tool)) {
        BodyKind.PATCH -> PatchBody(selection, openFile)
        BodyKind.OVERFLOW -> OverflowBody()
        BodyKind.SINGLE -> diffBody(selection)
    }

private fun popupBody(tool: Tool, selection: SessionSelection?, openFile: SessionFileOpener): EditBody =
    when (bodyKind(tool)) {
        BodyKind.PATCH -> PatchBody(selection, openFile, POPUP_OPTS)
        BodyKind.OVERFLOW -> OverflowBody()
        BodyKind.SINGLE -> popupDiffBody(selection)
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
    gutter = { editDiff(it).takeIf { patch -> patch.isNotBlank() }?.let(DiffLineNumbers::rows) },
)

private fun popupDiffBody(selection: SessionSelection?) = ToolMarkdownBody(
    POPUP_OPTS,
    selection,
    render = ::diffMarkdown,
    gutter = { editDiff(it).takeIf { patch -> patch.isNotBlank() }?.let(DiffLineNumbers::rows) },
)

internal val POPUP_OPTS = MdCodeBlockOptions(
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
