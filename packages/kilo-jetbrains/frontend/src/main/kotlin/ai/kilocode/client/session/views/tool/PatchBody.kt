package ai.kilocode.client.session.views.tool

import ai.kilocode.client.diff.DiffLineNumbers
import ai.kilocode.client.diff.installDiffGutter
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.NamedColorUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Component
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/**
 * Body surface shared by the single-file markdown diff ([ToolMarkdownBody]) and the multi-file
 * apply_patch view ([PatchBody]), so [EditToolView] can hold either behind one type and swap between
 * them when a streaming tool crosses the single/multi boundary.
 */
interface EditBody {
    var parent: Disposable?

    /**
     * When set and the diff exceeds [SessionUiStyle.View.Tool.DIFF_MAX_LINES], the body renders an
     * "open in a diff tab" placeholder instead of building embedded editors, and invokes this to open
     * the full diff in a background-backed tab. Null leaves the body uncapped (non-diff bodies).
     */
    var overflow: (() -> Unit)?

    @RequiresEdt fun mount(tool: Tool): JComponent
    @RequiresEdt fun created(): Boolean
    @RequiresEdt fun panel(): JComponent?
    @RequiresEdt fun attached(host: Component): Boolean
    @RequiresEdt fun update(tool: Tool): Boolean
    @RequiresEdt fun applyStyle(style: SessionEditorStyle): Boolean
    @RequiresEdt fun markdown(): String?
    @RequiresEdt fun codeEditors(): List<EditorTextField>
    @RequiresEdt fun disposeBody()
}

/**
 * Renders an apply_patch that touched several files as one section per file: a clickable filename
 * link (same chrome as the Read/Edit header link) plus a per-file changes badge, left-aligned to the
 * diff's own text inset, followed by that file's unified diff. Sections are rebuilt as a group when
 * the underlying file set changes, matching the retained-Swing rebuild-on-add/remove convention.
 */
class PatchBody(
    private val selection: SessionSelection?,
    private val openFile: SessionFileOpener,
    private val opts: MdCodeBlockOptions = DIFF_OPTS,
) : EditBody {
    override var parent: Disposable? = null
    override var overflow: (() -> Unit)? = null

    private var root: Stack? = null
    private var owner: Disposable? = null
    private val views = mutableListOf<MdView>()
    private val links = mutableListOf<FileLinkLabel>()
    private var style = SessionEditorStyle.current()
    private var signature = ""
    private val rows = mutableListOf<List<DiffLineNumbers.Row>>()

    @RequiresEdt
    override fun mount(tool: Tool): JComponent = mountFiles(editFiles(tool))

    @RequiresEdt
    internal fun mountFiles(files: List<EditFileChange>): JComponent {
        root?.let { return it }
        val panel = Stack.vertical()
        root = panel
        rebuild(files)
        return panel
    }

    @RequiresEdt
    override fun created(): Boolean = root != null

    @RequiresEdt
    override fun panel(): JComponent? = root

    @RequiresEdt
    override fun attached(host: Component): Boolean = root?.parent === host

    @RequiresEdt
    override fun update(tool: Tool): Boolean {
        return updateFiles(editFiles(tool))
    }

    @RequiresEdt
    internal fun updateFiles(files: List<EditFileChange>): Boolean {
        if (root == null) return false
        if (signatureOf(files) == signature) return false
        rebuild(files)
        return true
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle): Boolean {
        this.style = style
        var changed = false
        views.forEach { changed = applyMd(it) || changed }
        links.forEach { if (it.font != style.transcriptFont) { it.font = style.transcriptFont; changed = true } }
        return changed
    }

    @RequiresEdt
    override fun markdown(): String? {
        if (views.isEmpty()) return null
        return views.joinToString("\n\n") { it.markdown() }
    }

    @RequiresEdt
    override fun codeEditors(): List<EditorTextField> = views.flatMap { view ->
        (view.component as? JPanel)?.components
            ?.filterIsInstance<JBScrollPane>()
            ?.mapNotNull { it.viewport.view as? EditorTextField }
            ?: emptyList()
    }

    @RequiresEdt
    override fun disposeBody() {
        val panel = root
        owner?.let(Disposer::dispose)
        owner = null
        views.clear()
        links.clear()
        rows.clear()
        panel?.removeAll()
        signature = ""
    }

    @RequiresEdt
    private fun rebuild(files: List<EditFileChange>) {
        val panel = root ?: return
        val parent = parent ?: error("Patch body has no parent")
        disposeBody()
        val disposable = Disposer.newDisposable("Patch body")
        Disposer.register(parent, disposable)
        owner = disposable
        val open = overflow
        if (open != null && patchLineCount(files) > SessionUiStyle.View.Tool.DIFF_MAX_LINES) {
            // Building one editor per file for a very large aggregate diff walks every line on the EDT
            // (gutter reinit) and freezes; defer to the diff tab, which streams diffs off the EDT.
            panel.next(diffOverflowPanel(open))
        } else {
            files.filter { it.patch.isNotBlank() }.forEachIndexed { index, file ->
                if (index > 0) panel.gap(JBUI.scale(SessionUiStyle.View.Code.BLOCK_GAP))
                panel.next(header(file))
                panel.gap(UiStyle.Gap.sm())
                val md = MdViewFactory.create(style, selection, MdCodeBlockFactory.default(opts))
                Disposer.register(disposable, md)
                applyMd(md)
                md.set(patchMarkdown(file.patch))
                val nums = DiffLineNumbers.rows(file.patch)
                rows.add(nums)
                installGutter(md, nums)
                views.add(md)
                panel.next(md.component)
            }
        }
        signature = signatureOf(files)
        panel.revalidate()
        panel.repaint()
    }

    private fun signatureOf(files: List<EditFileChange>): String = files
        .joinToString("\u0000") { "${it.path}\u0001${it.additions}\u0001${it.deletions}\u0001${it.patch}" }

    @RequiresEdt
    private fun header(file: EditFileChange): JComponent {
        val link = FileLinkLabel(openFile).apply {
            foreground = UiStyle.Colors.fg()
            font = style.transcriptFont
            setTarget(file.path, tail(file.path))
            isVisible = true
        }
        links.add(link)
        val row = Stack.horizontal(UiStyle.Gap.sm())
            .next(link)
            .next(DiffStatBadge(file.additions, file.deletions))
        return JBUI.Panels.simplePanel(row).apply {
            isOpaque = false
            border = JBUI.Borders.compound(
                JBUI.Borders.customLineBottom(NamedColorUtil.getBoundsColor()),
                JBUI.Borders.emptyLeft(SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING),
            )
        }
    }

    private fun applyMd(md: MdView): Boolean {
        val before = md.font
        md.applyStyle(style)
        md.font = style.editorFont
        md.foreground = style.editorForeground
        md.background = style.editorBackground
        md.preBg = style.editorBackground
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        rows.getOrNull(views.indexOf(md))?.let { installGutter(md, it) }
        return before != md.font
    }

    @RequiresEdt
    private fun installGutter(md: MdView, rows: List<DiffLineNumbers.Row>) {
        ((md.component as? JPanel)?.components
            ?.filterIsInstance<JBScrollPane>()
            ?.mapNotNull { it.viewport.view as? EditorTextField }
            ?: emptyList()).forEach { installDiffGutter(it, rows) }
    }

    private companion object {
        val DIFF_OPTS = MdCodeBlockOptions(
            border = MdCodeBlockBorder.Bottom,
            maxLines = SessionUiStyle.View.Tool.DIFF_LINES,
            verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            editorOnly = true,
        )
    }
}
