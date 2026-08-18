package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.SessionContentPanel
import ai.kilocode.client.session.ui.SessionSurfacePanel
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.hybrid.MdTerminal
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Dimension
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

/**
 * Renders `bash` tool calls. The header stays a compact title row; the expanded body is a
 * [SessionContentPanel] holding the command and the output as two separate raised code surfaces
 * (no "Command"/"Output" labels), with a transparent footer reserved for ambient notes such as an
 * auto-approved reason.
 */
class ShellToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
    private val body: ShellBody = ShellBody(selection),
) : AbstractSessionPartView(parts.header, { body.mount(tool) }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        body.parent = this
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { body.markdown() ?: fallbackText() }
    }

    private fun fallbackText() = shellBodyText(item)

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        body.applyStyle(style)
        return true
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
    fun bodyText(): String = shellBodyText(item)

    @RequiresEdt
    fun hasToggle(): Boolean = arrow.isVisible

    @RequiresEdt
    internal fun bodyCreated() = body.created()

    @RequiresEdt
    internal fun bodyVisible() = body.attached(this)

    @RequiresEdt
    internal fun markdown() = body.markdown() ?: shellMarkdown(item)

    @RequiresEdt
    internal fun codeEditors(): List<EditorTextField> = body.codeEditors()

    @RequiresEdt
    internal fun scrolls(): List<JBScrollPane> = body.scrolls()

    @RequiresEdt
    internal fun commandFont() = codeEditors().firstOrNull()?.font ?: style.editorFont

    @RequiresEdt
    internal fun titleFont() = parts.title.font

    @RequiresEdt
    internal fun subtitleFont() = parts.sub.font

    @RequiresEdt
    internal fun subtitleForeground() = parts.sub.foreground

    @RequiresEdt
    internal fun subtitleMarkup() = parts.sub.text ?: ""

    @RequiresEdt
    internal fun stateFont() = parts.state.font

    @RequiresEdt
    internal fun controlCount() = if (arrow.isVisible) 1 else 0

    @RequiresEdt
    internal fun content(): SessionContentPanel? = body.panel()

    @RequiresEdt
    internal fun surfaces() = body.surfaces()

    @RequiresEdt
    internal fun horizontalPolicy() = body.scrolls().firstOrNull()?.horizontalScrollBarPolicy
        ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        val cmd = command(item)
        return popup("tool", "bash", cmd.isNotBlank()) { buildPopupBody(cmd) }
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        changed = setFont(parts.link, style.smallEditorFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        changed = body.applyStyle(style) || changed
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
        changed = setForeground(parts.sub, SessionUiStyle.Text.Secondary.foreground()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        return changed
    }

    private fun syncBody(): Boolean = body.update(item)

    @RequiresEdt
    private fun buildPopupBody(cmd: String): HeaderPopupBody =
        markdownPopupBody(
            style,
            popupShellMarkdown(item, cmd),
            options = SHELL_POPUP_OPTS,
            font = style.transcriptFont,
            foreground = style.editorForeground,
        ) { padPopup(it.component) }

    override fun dumpLabel() = "ShellToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool) = tool.name == "bash"
    }
}

/**
 * The expanded shell body: a [SessionContentPanel] with the command and output as two independent
 * markdown code surfaces. Each surface is a [SessionSurfacePanel] (rounded code-block background),
 * so the two blocks read as distinct raised boxes separated by the standard transparent gap. Both
 * are built lazily on first expansion and mutated in place afterwards.
 */
class ShellBody(private val selection: SessionSelection?) {
    var parent: Disposable? = null

    private var panel: SessionContentPanel? = null
    private var commandSurface: SessionSurfacePanel? = null
    private var outputSurface: SessionSurfacePanel? = null
    private var commandBody: ToolMarkdownBody? = null
    private var outputBody: ToolMarkdownBody? = null

    @RequiresEdt
    fun mount(tool: Tool): JComponent {
        panel?.let { return it }
        val owner = parent ?: error("Shell body has no parent")
        val panel = SessionContentPanel()
        val commandSurface = SessionSurfacePanel()
        val outputSurface = SessionSurfacePanel()
        val commandBody = shellSection(selection) { commandMarkdown(it) }
        val outputBody = shellSection(selection) { outputMarkdown(it) }
        commandBody.parent = owner
        outputBody.parent = owner
        commandSurface.addToCenter(commandBody.mount(tool))
        outputSurface.addToCenter(outputBody.mount(tool))
        panel.content(commandSurface).content(outputSurface)
        this.panel = panel
        this.commandSurface = commandSurface
        this.outputSurface = outputSurface
        this.commandBody = commandBody
        this.outputBody = outputBody
        update(tool)
        applyStyle(SessionEditorStyle.current())
        return panel
    }

    @RequiresEdt
    fun created(): Boolean = panel != null

    @RequiresEdt
    fun panel(): SessionContentPanel? = panel

    @RequiresEdt
    fun surfaces(): List<JComponent> = listOfNotNull(commandSurface, outputSurface)

    @RequiresEdt
    fun attached(host: Component): Boolean = panel?.parent === host

    @RequiresEdt
    fun update(tool: Tool): Boolean {
        val commandBody = commandBody ?: return false
        val outputBody = outputBody ?: return false
        val commandSurface = commandSurface ?: return false
        val outputSurface = outputSurface ?: return false
        var changed = false
        changed = commandBody.update(tool) || changed
        changed = outputBody.update(tool) || changed
        changed = show(commandSurface, command(tool).isNotBlank()) || changed
        changed = show(outputSurface, output(tool).isNotBlank() || !tool.error.isNullOrBlank()) || changed
        return changed
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle): Boolean {
        val commandBody = commandBody ?: return false
        val outputBody = outputBody ?: return false
        var changed = false
        changed = commandBody.applyStyle(style) || changed
        changed = outputBody.applyStyle(style) || changed
        return changed
    }

    @RequiresEdt
    fun markdown(): String? {
        if (panel == null) return null
        return listOfNotNull(commandBody?.markdown(), outputBody?.markdown())
            .filter { it.isNotBlank() }
            .joinToString("\n\n")
    }

    @RequiresEdt
    fun scrolls(): List<JBScrollPane> = commandBody?.scrolls().orEmpty() + outputBody?.scrolls().orEmpty()

    @RequiresEdt
    fun codeEditors(): List<EditorTextField> = commandBody?.codeEditors().orEmpty() + outputBody?.codeEditors().orEmpty()

    private fun show(surface: JComponent, visible: Boolean): Boolean {
        if (surface.isVisible == visible) return false
        surface.isVisible = visible
        return true
    }
}

/** Editor-only code block used by the collapsed shell hover popup (uncapped; the popup scrolls). */
private val SHELL_POPUP_OPTS = MdCodeBlockOptions(
    border = MdCodeBlockBorder.None,
    verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
    editorOnly = true,
)

private fun shellSection(selection: SessionSelection?, render: (Tool) -> String) = ToolMarkdownBody(
    MdCodeBlockOptions(
        border = MdCodeBlockBorder.None,
        maxLines = SessionUiStyle.View.Tool.BODY_LINES,
        verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
        editorOnly = true,
    ),
    selection,
    render = render,
    font = SessionEditorStyle::transcriptFont,
)

private fun padPopup(root: JComponent) {
    root.components.filterIsInstance<JBScrollPane>().forEach { pane ->
        val field = pane.viewport.view as? EditorTextField ?: return@forEach
        field.border = JBUI.Borders.empty(SessionUiStyle.View.Code.SCROLLBAR_HEIGHT, 0, 0, 0)
        val pad = field.border.getBorderInsets(field).top
        field.preferredSize = grow(field.preferredSize, pad)
        field.minimumSize = grow(field.minimumSize, pad)
        field.maximumSize = grow(field.maximumSize, pad)
        pane.preferredSize = grow(pane.preferredSize, pad)
        pane.minimumSize = grow(pane.minimumSize, pad)
        pane.maximumSize = grow(pane.maximumSize, pad)
    }
}

private fun grow(size: Dimension, pad: Int) = Dimension(size.width, size.height + pad)

/** Command markdown for the shell command surface: the raw command in a `bash` fence, or empty. */
private fun commandMarkdown(tool: Tool): String {
    val cmd = command(tool)
    if (cmd.isBlank()) return ""
    return fenced(cmd, "bash")
}

/** Output markdown for the shell output surface: the raw stdout then any stderr, or empty. */
private fun outputMarkdown(tool: Tool): String {
    val out = output(tool)
    val err = tool.error.orEmpty()
    return buildString {
        if (out.isNotBlank()) append(fenced(out, outputLang(out)))
        if (err.isNotBlank()) {
            if (isNotEmpty()) append("\n\n")
            append(fenced(err, "ansi-stderr"))
        }
    }
}

/** Full shell markdown (command surface then output surface), used for copy and popup fallbacks. */
private fun shellMarkdown(tool: Tool): String =
    listOf(commandMarkdown(tool), outputMarkdown(tool)).filter { it.isNotBlank() }.joinToString("\n\n")

/** Plain, terminal-cleaned shell text used as the copy fallback before the body is built. */
private fun shellBodyText(tool: Tool): String =
    listOf(command(tool), clean(output(tool)), clean(tool.error.orEmpty()))
        .filter { it.isNotBlank() }
        .joinToString("\n\n")

private fun fenced(text: String, lang: String): String = buildString {
    val fence = fence(text)
    append(fence).append(lang).append('\n')
    append(text)
    if (!text.endsWith('\n')) append('\n')
    append(fence)
}

private fun outputLang(text: String): String = if (MdTerminal.hasAnsi(text)) "ansi-stdout" else "shell-output"

private fun popupMd(text: String): String = buildString {
    val fence = fence(text)
    append(fence).append("bash\n")
    append(text)
    if (!text.endsWith('\n')) append('\n')
    append(fence)
}

/**
 * Popup markdown: the formatted command surface followed by the output/error surface, matching the
 * expanded body. Like the changes popup, the output is not line-capped here — the popup's own scroll
 * pane bounds its height — so the collapsed hover preview shows the command together with its output.
 */
private fun popupShellMarkdown(tool: Tool, cmd: String): String =
    listOf(popupMd(formatCommand(cmd)), outputMarkdown(tool))
        .filter { it.isNotBlank() }
        .joinToString("\n\n")

/**
 * Inserts line breaks after shell separators (`&&`, `||`, `|`, `;`) that sit outside quotes,
 * so a long single-line command reads as one statement per line in the popup. Quote and escape
 * state is tracked so separators inside string literals are left untouched.
 */
private fun formatCommand(cmd: String): String {
    val out = StringBuilder(cmd.length + 8)
    var quote = ' '
    var i = 0
    while (i < cmd.length) {
        val c = cmd[i]
        if (quote != ' ') {
            out.append(c)
            if (c == '\\' && quote == '"' && i + 1 < cmd.length) {
                out.append(cmd[i + 1])
                i += 2
                continue
            }
            if (c == quote) quote = ' '
            i++
            continue
        }
        val next = cmd.getOrNull(i + 1)
        when {
            c == '\'' || c == '"' -> { quote = c; out.append(c); i++ }
            c == '\\' && next != null -> { out.append(c).append(next); i += 2 }
            c == '&' && next == '&' -> { out.append("&&\n"); i += 2 }
            c == '|' && next == '|' -> { out.append("||\n"); i += 2 }
            c == '|' && next == '&' -> { out.append("|&\n"); i += 2 }
            c == '|' -> { out.append("|\n"); i++ }
            c == ';' -> { out.append(";\n"); i++ }
            else -> { out.append(c); i++ }
        }
    }
    return out.toString()
}

private fun clean(text: String): String = MdTerminal.strip(MdTerminal.reduce(text, keepSgr = false))
