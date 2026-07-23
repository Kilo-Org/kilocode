package ai.kilocode.client.session.views.tool

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

    private var root: Stack? = null
    private var owner: Disposable? = null
    private val views = mutableListOf<MdView>()
    private val links = mutableListOf<FileLinkLabel>()
    private var style = SessionEditorStyle.current()
    private var signature = ""

    @RequiresEdt
    override fun mount(tool: Tool): JComponent {
        root?.let { return it }
        val panel = Stack.vertical()
        root = panel
        rebuild(tool)
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
        if (root == null) return false
        if (signatureOf(tool) == signature) return false
        rebuild(tool)
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
        panel?.removeAll()
        signature = ""
    }

    @RequiresEdt
    private fun rebuild(tool: Tool) {
        val panel = root ?: return
        val parent = parent ?: error("Patch body has no parent")
        disposeBody()
        val disposable = Disposer.newDisposable("Patch body")
        Disposer.register(parent, disposable)
        owner = disposable
        editFiles(tool).filter { it.patch.isNotBlank() }.forEachIndexed { index, file ->
            if (index > 0) panel.gap(JBUI.scale(SessionUiStyle.View.Code.BLOCK_GAP))
            panel.next(header(file))
            panel.gap(UiStyle.Gap.sm())
            val md = MdViewFactory.create(style, selection, MdCodeBlockFactory.default(opts))
            Disposer.register(disposable, md)
            applyMd(md)
            md.set(patchMarkdown(file.patch))
            views.add(md)
            panel.next(md.component)
        }
        signature = signatureOf(tool)
        panel.revalidate()
        panel.repaint()
    }

    private fun signatureOf(tool: Tool): String = editFiles(tool)
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
            border = JBUI.Borders.emptyLeft(SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING)
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
        return before != md.font
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
