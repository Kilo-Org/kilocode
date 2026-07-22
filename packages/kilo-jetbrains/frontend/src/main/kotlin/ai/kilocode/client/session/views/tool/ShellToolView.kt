package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdCodeBlockBorder
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.client.ui.md.hybrid.MdTerminal
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class ShellToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
    private val body: ToolMarkdownBody = shellBody(selection),
) : SecondarySessionPartView(parts.header, { body.mount(tool) }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        body.parent = this
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { body.markdown() ?: fallbackText() }
    }

    private fun fallbackText() = ShellContent(item).body

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
    internal fun bodyCreated() = body.created()

    @RequiresEdt
    internal fun bodyVisible() = body.attached(this)

    @RequiresEdt
    internal fun markdown() = body.markdown() ?: ShellContent(item).markdown

    @RequiresEdt
    internal fun codeEditors(): List<EditorTextField> = body.codeEditors()

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
    internal fun mdComponent() = body.panel()

    @RequiresEdt
    internal fun horizontalPolicy() = body.scrolls().firstOrNull()?.horizontalScrollBarPolicy
        ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? {
        if (isExpanded()) return null
        val cmd = command(item).takeIf { it.isNotBlank() } ?: return null
        return HeaderPopupRequest(row, build = { buildPopupBody(cmd) }) {
            Telemetry.send("Header Popup Shown", mapOf("surface" to "session", "tool" to "bash"))
        }
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
        changed = setForeground(parts.sub, UiStyle.Colors.weak()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        return changed
    }

    private fun syncBody(): Boolean = body.update(item)

    @RequiresEdt
    private fun buildPopupBody(cmd: String): HeaderPopupBody {
        val md = MdViewFactory.create(
            style,
            null,
            MdCodeBlockFactory.default(
                MdCodeBlockOptions(
                    border = MdCodeBlockBorder.None,
                    verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                    editorOnly = true,
                ),
            ),
        )
        md.applyStyle(style)
        md.font = style.transcriptFont
        md.foreground = style.editorForeground
        md.background = style.editorBackground
        md.preBg = style.editorBackground
        md.codeFont = style.editorFamily
        md.component.border = JBUI.Borders.empty()
        md.set(popupMd(formatCommand(cmd)))
        padPopup(md.component)
        return HeaderPopupBody(md.component, md, style.editorBackground)
    }

    override fun dumpLabel() = "ShellToolView#$contentId(${labelText()})"

    companion object {
        fun canRender(tool: Tool) = tool.name == "bash"
    }
}

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

private fun shellBody(selection: SessionSelection?) = ToolMarkdownBody(
    MdCodeBlockOptions(
        border = MdCodeBlockBorder.Bottom,
        maxLines = 15,
        verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
        editorOnly = true,
    ),
    selection,
    render = { ShellContent(it).markdown },
    font = SessionEditorStyle::transcriptFont,
    chrome = ::styleShellHtml,
)

/** Pads the left edge of shell section headers ("Command"/"Output") to line up with code text. */
@RequiresEdt
private fun styleShellHtml(md: MdView) {
    val root = md.component as? JPanel ?: return
    root.components.filterIsInstance<JBHtmlPane>().forEach {
        it.border = JBUI.Borders.emptyLeft(SessionUiStyle.View.Code.VIEWPORT_HORIZONTAL_PADDING)
    }
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
        section(KiloBundle.message("session.part.tool.shell.command"), command, "bash")
        section(KiloBundle.message("session.part.tool.shell.output"), rawOutput, outputLang(rawOutput))
        section(KiloBundle.message("session.part.tool.shell.error"), rawError, "ansi-stderr")
    }
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

private fun clean(text: String): String = MdTerminal.strip(MdTerminal.reduce(text, keepSgr = false))
