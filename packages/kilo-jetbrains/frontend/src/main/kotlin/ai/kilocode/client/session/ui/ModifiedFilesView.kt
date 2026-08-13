package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
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
import javax.swing.JComponent

class ModifiedFilesView private constructor(
    private val openFile: SessionFileOpener,
    private val selection: SessionSelection? = null,
    private val parts: Header = Header(),
    private val body: PatchBody = PatchBody(selection, openFile),
) : SecondarySessionPartView(parts.panel, { body.mountFiles(emptyList()) }), SessionCopyTarget {
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
        body.overflow = ::openDiffViewer
        parts.diff.addActionListener { openDiffViewer() }
        isVisible = false
        bindHeader(parts.glyph, parts.title, parts.count, parts.panel.left, parts.bars, parts.anchor)
        applyStyle(style)
    }

    override val copyEligible: Boolean get() = diffs.isNotEmpty()
    override val copyAnchor: JComponent get() = parts.anchor
    override val copyToolbar: JComponent get() = parts.diff

    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?, turnId: String) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        this.turnId = turnId
    }

    /** Returns true when anything visible changed, so the parent only relayouts on a real change. */
    @RequiresEdt
    fun setDiffs(diffs: List<DiffFileDto>): Boolean {
        val next = diffs.map(::file)
        this.diffs = diffs
        if (files == next) {
            val visible = next.isNotEmpty()
            parts.diff.isEnabled = visible
            if (isVisible == visible) return false
            isVisible = visible
            revalidate()
            repaint()
            return true
        }
        files = next
        val visible = files.isNotEmpty()
        val additions = files.sumOf { it.additions }
        val deletions = files.sumOf { it.deletions }
        if (isVisible != visible) isVisible = visible
        if (!visible) collapse()
        parts.update(files.size, additions, deletions)
        parts.diff.isEnabled = visible
        if (isExpanded()) body.updateFiles(files)
        revalidate()
        repaint()
        return true
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

    override fun copyText(): String? = null

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
        openDiff(diffs, KiloBundle.message("diff.editor.changedFiles.title"), "turn:${sessionId ?: "pending"}:$turnId")
    }

    @RequiresEdt
    private fun buildPopup(files: List<EditFileChange>): HeaderPopupBody {
        val owner = Disposer.newDisposable("Modified files popup body")
        val popup = PatchBody(selection, openFile, POPUP_OPTS).also {
            it.parent = owner
            it.overflow = ::openDiffViewer
        }
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
        ).apply { isEnabled = false }
        val anchor = hoverPlaceholder(diff)
        val bars = DiffBars(0, 0)
        // Left-aligned header: icon, title, file count, sticks change badge, open-in-diff.
        val panel = PartHeader().apply {
            leading(glyph)
            left(title)
            titleGap()
            left(count, PartHeader.centered(bars), PartHeader.centered(anchor))
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
