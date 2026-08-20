package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionDiffOpener
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.selection.hoverPlaceholder
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.session.views.tool.EditFileChange
import ai.kilocode.client.session.views.tool.PatchBody
import ai.kilocode.client.session.views.tool.setFont
import ai.kilocode.client.session.views.tool.setForeground
import ai.kilocode.client.session.views.tool.setIcon
import ai.kilocode.client.ui.DiffBadge
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.toolbarButton
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

internal abstract class ChangesCardView(
    private val openFile: SessionFileOpener,
    private val selection: SessionSelection?,
    protected val parts: Header,
    private val body: PatchBody,
    private val linkFiles: Boolean,
) : AbstractSessionPartView(parts.panel, { body.mountFiles(emptyList()) }), SessionCopyTarget {
    protected var style = SessionEditorStyle.current()
    protected var files = emptyList<EditFileChange>()
    protected var items = emptyList<DiffFileDto>()
    protected var openDiff: SessionDiffOpener = { _, _, _ -> }
    protected var sessionId: String? = null

    override val copyEligible: Boolean get() = items.any(::openable)
    override val copyAnchor: JComponent get() = parts.anchor
    override val copyToolbar: JComponent get() = parts.diff

    init {
        body.parent = this
        body.overflow = ::openDiffViewer
        parts.diff.addActionListener { openDiffViewer() }
        applyStyle(style)
    }

    override fun copyText(): String? = null

    @RequiresEdt
    protected fun render(value: List<DiffFileDto>) {
        items = value
        files = value.map(::file)
        val additions = files.sumOf { it.additions }
        val deletions = files.sumOf { it.deletions }
        parts.update(files.size, additions, deletions)
        parts.diff.isEnabled = value.any(::openable)
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
        popup(popupKind, popupName, files.any { it.patch.isNotBlank() }) {
            PatchBody.popup(selection, openFile, files, style, linkFiles, ::openDiffViewer)
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
    protected fun cardBodyCreated() = body.created()

    @RequiresEdt
    protected fun cardBodyAttached() = body.attached(this)

    @RequiresEdt
    protected fun cardCodeEditors() = body.codeEditors()

    @RequiresEdt
    protected fun openDiffViewer() {
        val open = items.filter(::openable)
        if (open.isEmpty()) return
        openDiff(open, diffTitle(), diffToken())
    }

    protected abstract val popupKind: String
    protected abstract val popupName: String
    protected abstract fun openable(dto: DiffFileDto): Boolean
    protected abstract fun diffTitle(): String
    protected abstract fun diffToken(): String

    class Header(
        title: String,
        val badge: JComponent,
        private val stats: DiffBadge,
    ) {
        val glyph = JBLabel()
        val title = JBLabel(title)
        val count = JBLabel()
        val diff = toolbarButton(
            ToolbarButtonAction(SessionViewIcons.openDiff, KiloBundle.message("session.part.tool.openDiff")) {},
        ).apply { isEnabled = false }
        val anchor: JComponent = hoverPlaceholder(diff)
        val panel = PartHeader().apply {
            leading(glyph)
            left(this@Header.title)
            titleGap()
            left(count, PartHeader.centered(badge), anchor)
        }

        @RequiresEdt
        fun update(total: Int, additions: Int, deletions: Int) {
            count.text = KiloBundle.message(if (total == 1) "session.changes.count.one" else "session.changes.count.other", total)
            stats.update(additions, deletions)
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
}

private fun file(dto: DiffFileDto) = EditFileChange(
    path = dto.file,
    type = dto.status.orEmpty(),
    additions = dto.additions,
    deletions = dto.deletions,
    patch = dto.patch.orEmpty(),
)
