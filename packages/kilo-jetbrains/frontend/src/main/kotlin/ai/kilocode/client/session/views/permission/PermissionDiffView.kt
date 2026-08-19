package ai.kilocode.client.session.views.permission

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.PermissionFileDiff
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.hoverPlaceholder
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.tool.EditFileChange
import ai.kilocode.client.session.views.tool.POPUP_OPTS
import ai.kilocode.client.session.views.tool.PatchBody
import ai.kilocode.client.session.views.tool.setFont
import ai.kilocode.client.session.views.tool.setForeground
import ai.kilocode.client.session.views.tool.setIcon
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

/**
 * Renders proposed file changes inside a permission card with the same expandable body, popup
 * preview, and full diff-editor affordance used for modified files.
 */
class PermissionDiffView private constructor(
    private val openFile: SessionFileOpener,
    private val selection: SessionSelection?,
    private val parts: Header,
    private val body: PatchBody,
) : AbstractSessionPartView(parts.panel, { body.mountFiles(emptyList()) }) {
    override val contentId = CONTENT_ID

    private var style = SessionEditorStyle.current()
    private var files = emptyList<EditFileChange>()
    private var diffs = emptyList<DiffFileDto>()
    private var openDiff: SessionDiffOpener = { _, _, _ -> }
    private var sessionId: String? = null
    private var requestId: String? = null

    constructor(
        diffs: List<PermissionFileDiff>,
        openFile: SessionFileOpener,
        selection: SessionSelection?,
    ) : this(openFile, selection, Header(), PatchBody(selection, openFile)) {
        setDiffs(diffs)
    }

    init {
        body.parent = this
        body.overflow = ::openDiffViewer
        parts.diff.addActionListener { openDiffViewer() }
        applyStyle(style)
    }

    @RequiresEdt
    fun setDiffOpener(openDiff: SessionDiffOpener, sessionId: String?, requestId: String?) {
        this.openDiff = openDiff
        this.sessionId = sessionId
        this.requestId = requestId
    }

    @RequiresEdt
    fun setDiffs(value: List<PermissionFileDiff>) {
        diffs = value.map(::dto)
        files = diffs.map(::file)
        val additions = files.sumOf { it.additions }
        val deletions = files.sumOf { it.deletions }
        parts.update(files.size, additions, deletions)
        parts.diff.isEnabled = diffs.any(::hasOpenableContent)
        syncExpandable(files.any { it.patch.isNotBlank() })
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
    override fun headerPopup(): HeaderPopupRequest? =
        popup("permission", "diff", files.any { it.patch.isNotBlank() }) { buildPopup(files) }

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
    internal fun badgeForTest() = parts.badge

    @RequiresEdt
    internal fun openDiffForTest() = openDiffViewer()

    @RequiresEdt
    internal fun openDiffEnabledForTest() = parts.diff.isEnabled

    @RequiresEdt
    internal fun codeEditorsForTest() = body.codeEditors()

    @RequiresEdt
    internal fun countTextForTest() = parts.count.text

    private fun openDiffViewer() {
        val files = diffs.filter(::hasOpenableContent)
        if (files.isEmpty()) return
        openDiff(files, KiloBundle.message("session.permission.diff"), "permission:${sessionId ?: "pending"}:${requestId ?: "pending"}")
    }

    @RequiresEdt
    private fun buildPopup(files: List<EditFileChange>): HeaderPopupBody {
        val owner = Disposer.newDisposable("Permission diff popup body")
        val popup = PatchBody(selection, openFile, POPUP_OPTS).also {
            it.parent = owner
            it.overflow = ::openDiffViewer
        }
        val panel = popup.mountFiles(files)
        popup.applyStyle(style)
        return HeaderPopupBody(panel, owner, SessionUiStyle.Colors.codeBlockBackground(), SessionUiStyle.View.Popup.WIDE_MAX_WIDTH)
    }

    private class Header {
        val glyph = JBLabel()
        val title = JBLabel(KiloBundle.message("session.permission.diff"))
        val count = JBLabel()
        val diff = toolbarButton(
            ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("session.part.tool.openDiff")) {},
        ).apply { isEnabled = false }
        val anchor: JComponent = hoverPlaceholder(diff)
        val badge = DiffStatBadge(0, 0)
        val panel = PartHeader().apply {
            leading(glyph)
            left(title)
            titleGap()
            left(count, PartHeader.centered(badge), anchor)
        }

        @RequiresEdt
        fun update(total: Int, additions: Int, deletions: Int) {
            count.text = KiloBundle.message(if (total == 1) "session.changes.count.one" else "session.changes.count.other", total)
            badge.update(additions, deletions)
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            setIcon(glyph, SessionViewIcons.edit)
            setForeground(glyph, SessionUiStyle.View.Tool.completed())
            setFont(title, style.boldEditorFont)
            setFont(count, style.transcriptFont)
            setForeground(title, SessionUiStyle.Colors.foreground())
            setForeground(count, SessionUiStyle.Text.Secondary.foreground())
        }
    }

    private companion object {
        const val CONTENT_ID = "permission-diff"
    }
}

private fun dto(diff: PermissionFileDiff) = DiffFileDto(
    file = diff.file,
    additions = diff.additions,
    deletions = diff.deletions,
    patch = diff.patch,
    before = diff.before,
    after = diff.after,
)

private fun file(dto: DiffFileDto) = EditFileChange(
    path = dto.file,
    type = dto.status.orEmpty(),
    additions = dto.additions,
    deletions = dto.deletions,
    patch = dto.patch.orEmpty(),
)

private fun hasOpenableContent(dto: DiffFileDto) = !dto.patch.isNullOrBlank() || dto.before != null || dto.after != null
