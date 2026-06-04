@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Box
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/** Renders non-read tool calls with VS Code-inspired rows/cards. */
class ToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool),
) :
    SecondarySessionPartView(parts.header, { parts.scroll(tool) }) {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private var registered = false

    init {
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        applyStyle(style)
        sync()
    }

    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        applyBodyStyle()
        return true
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

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

    fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    fun commandText(): String = command(item)

    fun outputText(): String = output(item)
    fun bodyText(): String = body(item)
    internal fun previewText(): String = parts.text?.text ?: preview(item)
    fun hasToggle(): Boolean = arrow.isVisible
    internal fun bodyFont() = parts.text?.font ?: style.transcriptFont
    internal fun titleFont() = parts.title.font
    internal fun subtitleFont() = parts.sub.font
    internal fun stateFont() = parts.state.font
    internal fun bodyEditable() = parts.text?.isEditable ?: false
    internal fun bodyCaretVisible() = parts.text?.caret?.isVisible ?: false
    internal fun bodyVisible() = parts.scroll?.parent === this
    internal fun controlCount() = if (arrow.isVisible) 1 else 0
    internal fun horizontalPolicy() = parts.scroll?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    internal fun bodyWrap() = parts.text?.lineWrap ?: true
    internal fun bodyMaxRows() = SessionUiStyle.View.Tool.BODY_LINES
    internal fun bodyCreated() = parts.bodyCreated()

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.smallEditorFont) || changed
        changed = setFont(parts.link, style.smallEditorFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        changed = applyBodyStyle() || changed
        if (changed) refresh()
    }

    private fun sync(): Boolean {
        val expand = canExpand(item)
        var changed = false
        changed = syncExpandable(expand) || changed
        changed = setVisible(parts.state, !expand) || changed
        changed = syncLabels() || changed
        val text = parts.text
        if (text != null) changed = setForeground(text, bodyColor()) || changed
        return changed
    }

    private fun syncLabels(): Boolean {
        var changed = false
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, title(item)) || changed
        changed = setText(parts.sub, subtitle(item)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        return changed
    }

    private fun syncBody(): Boolean {
        var changed = false
        val text = parts.text ?: return false
        val value = preview(item)
        if (text.text != value) {
            text.text = value
            text.caretPosition = 0
            changed = true
        }
        changed = setForeground(text, bodyColor()) || changed
        return changed
    }

    private fun applyBodyStyle(): Boolean {
        val text = parts.text ?: return false
        if (!registered && selection != null && text.parent != null) {
            registered = true
            selection.register(text, this)
        }
        return setFont(text, style.transcriptFont)
    }

    private fun bodyColor() = if (item.state == ToolExecState.ERROR) UiStyle.Colors.errorLabelForeground() else UiStyle.Colors.fg()

    private fun bodyMaxHeight(): Int {
        val text = parts.text ?: return 0
        return text.getFontMetrics(text.font).height * bodyMaxRows() +
            JBUI.scale(SessionUiStyle.View.SESSION_VIEW_BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "ToolView#$contentId(${labelText()})"
}

/** Renders read calls with secondary, borderless chrome. */
class ReadToolView(
    tool: Tool,
    openFile: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool, openFile),
) : SecondarySessionPartView(parts.header, parts.scroll(tool), expandable = false) {

    companion object {
        fun canRender(tool: Tool): Boolean = tool.kind == ToolKind.READ
    }

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()

    init {
        parts.text?.let { selection?.register(it, this) }
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        parts.text?.text = preview(item)
        applyStyle(style)
        sync()
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        var changed = sync()
        changed = syncBody() || changed
        if (changed) refresh()
    }

    fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")
    fun bodyText(): String = body(item)
    internal fun bodyVisible() = parts.scroll?.parent === this
    internal fun hasToggle() = arrow.isVisible
    internal fun horizontalPolicy() = parts.scroll?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    internal fun bodyMaxRows() = SessionUiStyle.View.Tool.BODY_LINES
    internal fun bodyFont() = parts.text?.font ?: style.transcriptFont
    internal fun linkVisible() = parts.link.isVisible
    internal fun linkText() = parts.label
    internal fun linkMarkup() = parts.link.text ?: ""
    internal fun linkForeground() = parts.link.foreground
    internal fun linkFont() = parts.link.font
    internal fun subtitleForeground() = parts.sub.foreground
    internal fun subtitleFont() = parts.sub.font
    internal fun linkHref() = parts.href
    internal fun openLink() = parts.openLink()

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.transcriptFont) || changed
        changed = setFont(parts.link, style.transcriptFont) || changed
        changed = setFont(parts.state, style.smallEditorFont) || changed
        parts.text?.let { changed = setFont(it, style.transcriptFont) || changed }
        if (changed) refresh()
    }

    private fun sync(): Boolean {
        var changed = false
        changed = syncExpandable(false) || changed
        changed = setVisible(parts.state, true) || changed
        changed = setIcon(parts.glyph, icon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, title(item)) || changed
        changed = syncSubtitle() || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setForeground(parts.sub, UiStyle.Colors.fg()) || changed
        changed = setForeground(parts.link, UiStyle.Colors.fg()) || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        parts.text?.let { changed = setForeground(it, bodyColor()) || changed }
        return changed
    }

    private fun syncSubtitle(): Boolean {
        val target = target(item)?.takeIf { it.type == "file" }
        if (target != null) {
            var changed = false
            if (parts.href != target.path) {
                parts.href = target.path
                changed = true
            }
            changed = setLinkText(parts, tail(target.path).ifBlank { target.path }) || changed
            changed = show(parts, true) || changed
            return changed
        }

        var changed = false
        if (parts.href != null) {
            parts.href = null
            changed = true
        }
        changed = setText(parts.sub, subtitle(item)) || changed
        changed = show(parts, false) || changed
        return changed
    }

    private fun syncBody(): Boolean {
        val value = preview(item)
        val text = parts.text ?: return false
        if (text.text == value) return false
        text.text = value
        text.caretPosition = 0
        return true
    }

    private fun bodyColor() = if (item.state == ToolExecState.ERROR) UiStyle.Colors.errorLabelForeground() else UiStyle.Colors.fg()

    private fun bodyMaxHeight(): Int {
        val text = parts.text ?: return 0
        return text.getFontMetrics(text.font).height * bodyMaxRows() +
            JBUI.scale(SessionUiStyle.View.SESSION_VIEW_BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "ReadToolView#$contentId(${labelText()})"
}

class ToolParts(
    val header: JPanel,
    val glyph: JBLabel,
    val title: JBLabel,
    val sub: JBLabel,
    val link: JBLabel,
    val slot: JPanel,
    val state: JBLabel,
    val center: JPanel,
    val controls: JComponent,
    private val open: ((String) -> Unit)? = null,
) {
    var href: String? = null
    var label: String = ""
    private var body: ToolBody? = null

    val text: JBTextArea?
        get() = body?.text

    val scroll: JBScrollPane?
        get() = body?.scroll

    fun scroll(tool: Tool): JBScrollPane = body(tool).scroll

    fun bodyCreated() = body != null

    fun openLink() {
        val value = href ?: return
        open?.invoke(value)
    }

    private fun body(tool: Tool): ToolBody {
        val item = body
        if (item != null) return item
        val text = JBTextArea().apply {
            isEditable = false
            caret.isVisible = false
            caret.isSelectionVisible = true
            lineWrap = true
            wrapStyleWord = true
            foreground = if (tool.state == ToolExecState.ERROR) UiStyle.Colors.errorLabelForeground() else UiStyle.Colors.fg()
            background = SessionUiStyle.View.surface()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.SESSION_VIEW_VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.SESSION_VIEW_HORIZONTAL_PADDING),
            )
        }
        val scroll = JBScrollPane(text).apply {
            border = SessionUiStyle.View.topOutline()
            isOpaque = true
            background = SessionUiStyle.View.surface()
            viewport.background = SessionUiStyle.View.surface()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        return ToolBody(text, scroll).also { body = it }
    }
}

class ToolBody(
    val text: JBTextArea,
    val scroll: JBScrollPane,
)

private const val SUB_CARD = "sub"
private const val LINK_CARD = "link"

private fun toolParts(tool: Tool, openFile: ((String) -> Unit)? = null): ToolParts {
    lateinit var parts: ToolParts
    val glyph = JBLabel()
    val title = JBLabel()
    val sub = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val link = JBLabel().apply {
        isVisible = false
        isFocusable = false
        foreground = UiStyle.Colors.fg()
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        setRequestFocusEnabled(false)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                parts.openLink()
            }
        })
    }
    val slot = JPanel(CardLayout()).apply {
        isOpaque = false
        add(sub, SUB_CARD)
        add(link, LINK_CARD)
    }
    val state = JBLabel().apply { foreground = UiStyle.Colors.weak() }
    val center = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0)).apply { isOpaque = false }
    val controls = Box.createHorizontalBox()
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0)).apply {
        isOpaque = false
        center.add(title, BorderLayout.WEST)
        center.add(slot, BorderLayout.CENTER)
        add(glyph, BorderLayout.WEST)
        add(center, BorderLayout.CENTER)
        add(controls, BorderLayout.EAST)
    }
    parts = ToolParts(header, glyph, title, sub, link, slot, state, center, controls, openFile)
    return parts.also {
        controls.add(it.state)
    }
}

private fun icon(tool: Tool) = when (tool.name) {
    "read" -> AllIcons.Actions.Preview
    "bash" -> AllIcons.Debugger.Console
    else -> when (tool.state) {
        ToolExecState.PENDING -> AllIcons.Process.Step_1
        ToolExecState.RUNNING -> AllIcons.Process.Step_2
        ToolExecState.COMPLETED -> AllIcons.Actions.Checked
        ToolExecState.ERROR -> AllIcons.General.Error
    }
}

private fun title(tool: Tool) = when (tool.name) {
    "read" -> KiloBundle.message("session.part.tool.read")
    "bash" -> KiloBundle.message("session.part.tool.shell")
    else -> toolTitle(tool)
}

private fun subtitle(tool: Tool) = when (tool.name) {
    "read" -> readPath(tool)
    "bash" -> shellTitle(tool)
    else -> toolSubtitle(tool)
}

private fun setText(label: JBLabel, text: String): Boolean {
    val value = if (text.isBlank()) "" else XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(text))
    if (label.text == value) return false
    label.text = value
    return true
}

private fun setLinkText(parts: ToolParts, text: String): Boolean {
    val value = if (text.isBlank()) "" else XmlStringUtil.wrapInHtml("<u>${XmlStringUtil.escapeString(text)}</u>")
    if (parts.label == text && parts.link.text == value) return false
    parts.label = text
    parts.link.text = value
    return true
}

private fun show(parts: ToolParts, link: Boolean): Boolean {
    if (parts.link.isVisible == link && parts.sub.isVisible != link) return false
    (parts.slot.layout as CardLayout).show(parts.slot, if (link) LINK_CARD else SUB_CARD)
    return true
}

private fun subtitleText(parts: ToolParts): String = if (parts.link.isVisible) parts.label else parts.sub.text

private fun setIcon(label: JBLabel, icon: Icon): Boolean {
    if (label.icon === icon) return false
    label.icon = icon
    return true
}

private fun setVisible(component: JComponent, visible: Boolean): Boolean {
    if (component.isVisible == visible) return false
    component.isVisible = visible
    return true
}

private fun setForeground(component: JComponent, color: Color): Boolean {
    if (same(component.foreground, color)) return false
    component.foreground = color
    return true
}

private fun setFont(component: JComponent, font: Font): Boolean {
    if (component.font == font) return false
    component.font = font
    return true
}

private fun same(a: Color?, b: Color): Boolean = a?.rgb == b.rgb

private fun color(tool: Tool) = when (tool.state) {
    ToolExecState.PENDING -> SessionUiStyle.View.Tool.pending()
    ToolExecState.RUNNING -> SessionUiStyle.View.Tool.running()
    ToolExecState.COMPLETED -> SessionUiStyle.View.Tool.completed()
    ToolExecState.ERROR -> SessionUiStyle.View.Tool.error()
}

private fun titleColor(tool: Tool) = if (tool.state == ToolExecState.ERROR) {
    UiStyle.Colors.errorLabelForeground()
} else {
    UiStyle.Colors.fg()
}

private fun stateText(tool: Tool) = when (tool.state) {
    ToolExecState.PENDING -> KiloBundle.message("session.part.tool.pending")
    ToolExecState.RUNNING -> KiloBundle.message("session.part.tool.running")
    ToolExecState.COMPLETED -> ""
    ToolExecState.ERROR -> KiloBundle.message("session.part.tool.error")
}

private fun readPath(tool: Tool): String {
    val target = target(tool)
    if (target != null) {
        if (target.type == "file") return tail(target.path).ifBlank { target.path }
        return target.path
    }
    val path = tool.input["filePath"] ?: tool.input["path"] ?: tool.title ?: return tool.name
    return tail(path).ifBlank { path }
}

private data class Target(
    val path: String,
    val type: String,
)

private fun target(tool: Tool): Target? {
    val out = output(tool)
    if (out.isBlank()) return null
    val path = tag(out, "path") ?: return null
    val type = tag(out, "type") ?: return null
    return Target(path, type.lowercase())
}

private fun tag(text: String, name: String): String? =
    Regex("<$name>\\s*([\\s\\S]*?)\\s*</$name>")
        .find(text)
        ?.groupValues
        ?.getOrNull(1)
        ?.trim()
        ?.takeIf { it.isNotBlank() }

private fun shellTitle(tool: Tool): String =
    tool.input["description"]?.takeIf { it.isNotBlank() }
        ?: tool.metadata["description"]?.takeIf { it.isNotBlank() }
        ?: tool.title?.takeIf { it.isNotBlank() }
        ?: command(tool).lineSequence().firstOrNull { it.isNotBlank() }
        ?: ""

private fun command(tool: Tool): String =
    tool.input["command"]?.takeIf { it.isNotBlank() }
        ?: tool.metadata["command"]?.takeIf { it.isNotBlank() }
        ?: ""

private fun output(tool: Tool): String =
    tool.output?.takeIf { it.isNotBlank() }
        ?: tool.metadata["output"]?.takeIf { it.isNotBlank() }
        ?: ""

private fun preview(tool: Tool): String = if (tool.name == "bash") shellPreview(tool) else plainPreview(tool)

private fun body(tool: Tool): String = if (tool.name == "bash") shellBody(tool) else plainBody(tool)

private fun shellPreview(tool: Tool): String {
    val cmd = command(tool)
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return Preview().apply {
        if (cmd.isNotBlank()) append("$ ").append(cmd)
        if (out.isNotBlank()) {
            sep()
            append(out)
        }
        if (err != null) {
            sep()
            append(err)
        }
    }.build()
}

private fun shellBody(tool: Tool): String {
    val cmd = command(tool)
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return buildString {
        if (cmd.isNotBlank()) append("$ ").append(cmd)
        if (out.isNotBlank()) {
            if (isNotEmpty()) append("\n\n")
            append(out)
        }
        if (err != null) {
            if (isNotEmpty()) append("\n\n")
            append(err)
        }
    }
}

private fun plainPreview(tool: Tool): String {
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return Preview().apply {
        if (out.isNotBlank()) append(out)
        if (err != null) {
            sep()
            append(err)
        }
    }.build()
}

private fun plainBody(tool: Tool): String {
    val out = output(tool)
    val err = tool.error?.takeIf { it.isNotBlank() }
    return listOf(out, err).filter { !it.isNullOrBlank() }.joinToString("\n\n")
}

private fun canExpand(tool: Tool): Boolean {
    if (tool.name == "bash") return command(tool).isNotBlank() || output(tool).isNotBlank() || !tool.error.isNullOrBlank()
    return output(tool).isNotBlank() || !tool.error.isNullOrBlank()
}

private fun toolTitle(tool: Tool): String =
    tool.title?.takeIf { it.isNotBlank() }
        ?: tool.name.replace('_', ' ').replaceFirstChar { it.titlecase() }

private fun toolSubtitle(tool: Tool): String {
    val base = listOf("description", "query", "url", "filePath", "path", "name")
        .mapNotNull { tool.input[it]?.takeIf { value -> value.isNotBlank() } }
        .firstOrNull()
    val args = listOf("pattern", "include", "offset", "limit")
        .mapNotNull { key -> tool.input[key]?.takeIf { it.isNotBlank() }?.let { "$key=$it" } }
    return listOfNotNull(base).plus(args).joinToString(" ")
}

private fun tail(path: String): String {
    val value = path.trimEnd('/', '\\')
    val index = maxOf(value.lastIndexOf('/'), value.lastIndexOf('\\'))
    if (index < 0) return value
    return value.substring(index + 1)
}

private class Preview {
    private val text = StringBuilder()
    private var cut = false

    fun append(value: String): Preview {
        if (cut) return this
        val rem = SessionUiStyle.View.Tool.PREVIEW_LIMIT - text.length
        if (value.length <= rem) {
            text.append(value)
            return this
        }
        if (rem > 0) text.append(value, 0, rem)
        cut = true
        return this
    }

    fun sep(): Preview {
        if (text.isNotEmpty()) append("\n\n")
        return this
    }

    fun build(): String {
        if (!cut) return text.toString()
        if (text.isNotEmpty()) text.append("\n\n")
        text.append(KiloBundle.message("session.part.tool.truncated"))
        return text.toString()
    }
}
