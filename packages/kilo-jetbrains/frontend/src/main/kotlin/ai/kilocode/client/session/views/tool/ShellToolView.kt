package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.client.ui.md.hybrid.MdTerminal
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class ShellToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
    private val holder: ShellHolder = ShellHolder(tool, selection),
) : SecondarySessionPartView(parts.header, { holder.body().panel }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        holder.parent = this
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { holder.shell?.markdown() ?: fallbackText() }
    }

    private fun fallbackText() = ShellContent(item).body

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        holder.shell?.applyStyle(style)
        return true
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + (holder.shell?.panel?.preferredSize?.height ?: 0)
        return Dimension(size.width, minOf(size.height, height))
    }

    @RequiresEdt
    override fun update(content: Content) {
        if (content !is Tool) return
        val was = item.name
        item = content
        var changed = false
        if (was != content.name || !canExpand(content)) changed = collapse() || changed
        changed = sync() || changed
        changed = syncBody() || changed
        if (changed) refresh()
    }

    @RequiresEdt
    fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    @RequiresEdt
    fun commandText(): String = command(item)

    @RequiresEdt
    fun outputText(): String = clean(output(item))

    @RequiresEdt
    fun errorText(): String = clean(item.error.orEmpty())

    @RequiresEdt
    fun bodyText(): String = ShellContent(item).body

    @RequiresEdt
    fun hasToggle(): Boolean = arrow.isVisible

    @RequiresEdt
    internal fun bodyCreated() = holder.shell != null

    @RequiresEdt
    internal fun bodyVisible() = holder.shell?.panel?.parent === this

    @RequiresEdt
    internal fun markdown() = holder.shell?.markdown() ?: ShellContent(item).markdown

    @RequiresEdt
    internal fun codeEditors(): List<EditorTextField> = holder.shell?.codeEditors() ?: emptyList()

    @RequiresEdt
    internal fun commandFont() = codeEditors().firstOrNull()?.font ?: style.editorFont

    @RequiresEdt
    internal fun titleFont() = parts.title.font

    @RequiresEdt
    internal fun subtitleFont() = parts.sub.font

    @RequiresEdt
    internal fun subtitleForeground() = parts.sub.foreground

    @RequiresEdt
    internal fun stateFont() = parts.state.font

    @RequiresEdt
    internal fun controlCount() = if (arrow.isVisible) 1 else 0

    @RequiresEdt
    internal fun mdComponent() = holder.shell?.mdComponent()

    @RequiresEdt
    internal fun horizontalPolicy() = holder.shell?.scrolls()?.firstOrNull()?.horizontalScrollBarPolicy
        ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        changed = setFont(parts.link, style.smallEditorFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        holder.shell?.let { changed = it.applyStyle(style) || changed }
        if (changed) refresh()
    }

    private fun sync(): Boolean {
        val expand = canExpand(item)
        var changed = false
        changed = syncExpandable(expand) || changed
        changed = setVisible(parts.state, !expand) || changed
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, title(item)) || changed
        changed = setText(parts.sub, subtitle(item)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setForeground(parts.sub, UiStyle.Colors.weak()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        return changed
    }

    private fun syncBody(): Boolean {
        val body = holder.shell ?: return false
        return body.update(item)
    }

    override fun dumpLabel() = "ShellToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool) = tool.name == "bash"
    }
}

class ShellHolder(
    private val tool: Tool,
    private val selection: SessionSelection?,
) {
    var parent: Disposable? = null
    var shell: ShellBody? = null

    @RequiresEdt
    fun body(): ShellBody {
        val current = shell
        if (current != null) return current
        val owner = parent ?: error("Shell holder has no parent")
        return ShellBody(tool, selection, owner).also {
            shell = it
            Disposer.register(owner, it)
        }
    }
}

class ShellBody(
    tool: Tool,
    selection: SessionSelection?,
    parent: Disposable,
) : Disposable {
    private val md = MdViewFactory.create(
        SessionEditorStyle.current(),
        selection,
        MdCodeBlockFactory.default(
            MdCodeBlockOptions(
                border = MdCodeBlockBorder.Bottom,
                maxLines = 15,
                verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                editorOnly = true,
            ),
        ),
    )
    val panel = md.component

    init {
        Disposer.register(parent, md)
        applyStyle(SessionEditorStyle.current())
        update(tool)
    }

    @RequiresEdt
    fun update(tool: Tool): Boolean {
        val content = ShellContent(tool)
        if (md.markdown() == content.markdown) return false
        md.set(content.markdown)
        styleShell()
        return true
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle): Boolean {
        val before = md.font
        md.applyStyle(style)
        md.font = style.transcriptFont
        md.foreground = style.editorForeground
        md.background = style.editorBackground
        md.preBg = style.editorBackground
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        styleShell()
        return before != md.font
    }

    @RequiresEdt
    private fun styleShell() {
        val root = md.component as? JPanel ?: return
        root.components.filterIsInstance<JBHtmlPane>().forEach {
            it.border = JBUI.Borders.emptyLeft(JBUI.scale(SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING))
        }
    }

    @RequiresEdt
    fun markdown() = md.markdown()

    @RequiresEdt
    fun mdComponent() = md.component

    @RequiresEdt
    fun scrolls(): List<JBScrollPane> = (md.component as? JPanel)?.components?.filterIsInstance<JBScrollPane>() ?: emptyList()

    @RequiresEdt
    fun codeEditors(): List<EditorTextField> = scrolls().mapNotNull { it.viewport.view as? EditorTextField }

    override fun dispose() = Unit
}

private data class ShellContent(
    val command: String,
    val output: String,
    val error: String,
    val rawOutput: String = output,
    val rawError: String = error,
) {
    constructor(tool: Tool) : this(
        command(tool),
        clean(output(tool)),
        clean(tool.error.orEmpty()),
        output(tool),
        tool.error.orEmpty(),
    )

    val body: String = listOf(command, output, error).filter { it.isNotBlank() }.joinToString("\n\n")

    val markdown: String = buildString {
        section(KiloBundle.message("session.part.tool.shell.command"), command, "shell-command")
        section(KiloBundle.message("session.part.tool.shell.output"), rawOutput, outputLang(rawOutput))
        section(KiloBundle.message("session.part.tool.shell.error"), rawError, "ansi-stderr")
    }
}

private fun outputLang(text: String): String = if (MdTerminal.hasAnsi(text)) "ansi-stdout" else "shell-output"

private fun StringBuilder.section(title: String, text: String, lang: String) {
    if (text.isBlank()) return
    if (isNotEmpty()) append("\n\n")
    val fence = fence(text)
    append("**").append(title).append("**\n\n")
    append(fence).append(lang).append("\n")
    append(text)
    if (!text.endsWith('\n')) append('\n')
    append(fence)
}

private fun fence(text: String): String {
    val size = Regex("`+").findAll(text).maxOfOrNull { it.value.length } ?: 0
    return "`".repeat(maxOf(3, size + 1))
}

private fun clean(text: String): String = MdTerminal.strip(MdTerminal.reduce(text, keepSgr = false))
