package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.session.views.tool.EditFileChange
import ai.kilocode.client.session.views.tool.POPUP_OPTS
import ai.kilocode.client.session.views.tool.PatchBody
import ai.kilocode.client.session.views.tool.setFont
import ai.kilocode.client.session.views.tool.setForeground
import ai.kilocode.client.session.views.tool.setIcon
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.DiffBars
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt

class ModifiedFilesView private constructor(
    private val openFile: SessionFileOpener,
    private val selection: SessionSelection? = null,
    private val parts: Header = Header(),
    private val body: PatchBody = PatchBody(selection, openFile),
) : SecondarySessionPartView(parts.panel, { body.mountFiles(emptyList()) }) {
    override val contentId = CONTENT_ID

    private var style = SessionEditorStyle.current()
    private var files = emptyList<EditFileChange>()
    private var diffs = emptyList<DiffFileDto>()
    private var openDiff: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var turnId: String = CONTENT_ID

    constructor(
        openFile: SessionFileOpener,
        selection: SessionSelection? = null,
    ) : this(openFile, selection, Header(), PatchBody(selection, openFile))

    init {
        body.parent = this
        parts.diff.addActionListener { openDiffViewer() }
        isVisible = false
        bindHeader(parts.glyph, parts.title, parts.count, parts.panel.left, parts.panel.right, parts.bars)
        unbindHeader(parts.diff)
        applyStyle(style)
    }

    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?, turnId: String) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        this.turnId = turnId
    }

    @RequiresEdt
    fun setDiffs(diffs: List<DiffFileDto>) {
        val next = diffs.map(::file)
        this.diffs = diffs
        if (files == next) {
            val visible = next.isNotEmpty()
            parts.diff.isVisible = visible
            if (isVisible == visible) return
            isVisible = visible
            revalidate()
            repaint()
            return
        }
        files = next
        val visible = files.isNotEmpty()
        val additions = files.sumOf { it.additions }
        val deletions = files.sumOf { it.deletions }
        if (isVisible != visible) isVisible = visible
        if (!visible) collapse()
        parts.update(files.size, additions, deletions)
        parts.diff.isVisible = visible
        if (isExpanded()) body.updateFiles(files)
        revalidate()
        repaint()
    }

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        body.updateFiles(files)
        body.applyStyle(style)
        return true
    }

    @RequiresEdt
    override fun update(content: Content) = Unit

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        if (isExpanded() || files.isEmpty()) return null
        return HeaderPopupRequest(row, build = { buildPopup(files) }) {
            Telemetry.send("Header Popup Shown", mapOf("surface" to "session", "tool" to "changes"))
        }
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        parts.applyStyle(style)
        body.applyStyle(style)
        refresh()
    }

    override fun dispose() {
        body.disposeBody()
        super.dispose()
    }

    @RequiresEdt
    internal fun bodyCreated() = body.created()

    @RequiresEdt
    internal fun bodyVisible() = body.attached(this)

    @RequiresEdt
    internal fun countText() = parts.count.text

    private fun openDiffViewer() {
        if (diffs.isEmpty()) return
        openDiff(diffs, KiloBundle.message("diff.editor.inline.title"), "turn:${sessionId ?: "pending"}:$turnId")
    }

    @RequiresEdt
    private fun buildPopup(files: List<EditFileChange>): HeaderPopupBody {
        val owner = Disposer.newDisposable("Modified files popup body")
        val popup = PatchBody(selection, openFile, POPUP_OPTS).also { it.parent = owner }
        val panel = popup.mountFiles(files)
        popup.applyStyle(style)
        return HeaderPopupBody(panel, owner, style.editorBackground, SessionUiStyle.View.Popup.WIDE_MAX_WIDTH)
    }

    private class Header {
        val glyph = JBLabel()
        val title = JBLabel(KiloBundle.message("session.changes.modified"))
        val count = JBLabel()
        val diff = toolbarButton(
            ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("session.part.tool.openDiff")) {},
        ).apply { isVisible = false }
        val bars = DiffBars(0, 0)
        // Glyph, title, count, and the open-diff action on the left; diff bars hug the right edge.
        val panel = PartHeader().apply {
            left(glyph, title, count, PartHeader.centered(diff))
            right(PartHeader.centered(bars))
        }

        @RequiresEdt
        fun update(total: Int, additions: Int, deletions: Int) {
            val text = KiloBundle.message(if (total == 1) "session.changes.count.one" else "session.changes.count.other", total)
            if (count.text != text) count.text = text
            bars.update(additions, deletions)
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            setIcon(glyph, SessionViewIcons.edit)
            setForeground(glyph, SessionUiStyle.View.Tool.completed())
            setFont(title, style.boldEditorFont)
            setFont(count, style.transcriptFont)
            setForeground(title, UiStyle.Colors.fg())
            setForeground(count, UiStyle.Colors.weak())
        }
    }

    private companion object {
        const val CONTENT_ID = "session-modified-files"
    }
}

private fun file(dto: DiffFileDto) = EditFileChange(
    path = dto.file,
    type = "",
    additions = dto.additions,
    deletions = dto.deletions,
    patch = dto.patch.orEmpty(),
)
