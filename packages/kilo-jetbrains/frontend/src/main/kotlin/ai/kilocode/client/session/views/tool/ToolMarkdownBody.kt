package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
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
import java.awt.Font
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * A markdown-backed tool body (unified diff, shell transcript, ...) that is built lazily on first
 * expansion and then mutated in place. Shared by [ShellToolView] and [EditToolView] so the
 * lazy-init, styling, disposal, and editor-lookup logic lives in one place instead of being
 * duplicated per tool.
 *
 * [render] turns the current [Tool] into the markdown to display, [font] picks the body font from
 * the active style, and [chrome] applies any per-view tweaks after the markdown is (re)built.
 */
class ToolMarkdownBody(
    private val opts: MdCodeBlockOptions,
    private val selection: SessionSelection?,
    private val render: (Tool) -> String,
    private val font: (SessionEditorStyle) -> Font = SessionEditorStyle::editorFont,
    private val chrome: (MdView) -> Unit = {},
) {
    var parent: Disposable? = null
    private var view: MdView? = null

    /** Builds the body on first call, wiring it into [parent]'s disposable tree, then returns it. */
    @RequiresEdt
    fun mount(tool: Tool): JComponent {
        view?.let { return it.component }
        val owner = parent ?: error("Tool markdown body has no parent")
        val md = MdViewFactory.create(SessionEditorStyle.current(), selection, MdCodeBlockFactory.default(opts))
        Disposer.register(owner, md)
        view = md
        applyStyle(SessionEditorStyle.current())
        update(tool)
        return md.component
    }

    @RequiresEdt
    fun created(): Boolean = view != null

    @RequiresEdt
    fun panel(): JComponent? = view?.component

    @RequiresEdt
    fun attached(host: Component): Boolean = view?.component?.parent === host

    @RequiresEdt
    fun update(tool: Tool): Boolean {
        val md = view ?: return false
        val value = render(tool)
        if (md.markdown() == value) return false
        md.set(value)
        chrome(md)
        return true
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle): Boolean {
        val md = view ?: return false
        val before = md.font
        md.applyStyle(style)
        md.font = font(style)
        md.foreground = style.editorForeground
        md.background = style.editorBackground
        md.preBg = style.editorBackground
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        chrome(md)
        return before != md.font
    }

    @RequiresEdt
    fun markdown(): String? = view?.markdown()

    @RequiresEdt
    fun scrolls(): List<JBScrollPane> =
        (view?.component as? JPanel)?.components?.filterIsInstance<JBScrollPane>() ?: emptyList()

    @RequiresEdt
    fun codeEditors(): List<EditorTextField> = scrolls().mapNotNull { it.viewport.view as? EditorTextField }
}
