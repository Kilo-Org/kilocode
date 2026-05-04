@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
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
import javax.swing.SwingUtilities

/** Renders tool calls with VS Code-inspired rows/cards. */
class ToolView(tool: Tool) : PartView() {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionStyle.current()

    private val root = JPanel(BorderLayout()).apply {
        isOpaque = true
        background = UiStyle.Colors.surface()
        border = UiStyle.Card.border()
    }
    private val header = JPanel(UiStyle.Card.layout()).apply {
        isOpaque = true
        background = UiStyle.Colors.header()
        border = UiStyle.Card.headerInsets()
    }
    private val glyph = JBLabel()
    private val title = JBLabel()
    private val sub = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }
    private val state = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }
    private val arrow = JBLabel()
    private val center = JPanel(UiStyle.Card.layout()).apply {
        isOpaque = false
    }
    private val controls: JComponent = Box.createHorizontalBox().apply {
        add(state)
        add(arrow)
    }
    private val text = JBTextArea().apply {
        isEditable = false
        caret.isVisible = false
        caret.isSelectionVisible = false
        lineWrap = true
        wrapStyleWord = true
        foreground = bodyColor()
        background = UiStyle.Colors.surface()
        border = UiStyle.Card.bodyInsets()
    }
    private val scroll = JBScrollPane(text).apply {
        border = UiStyle.Card.divider()
        isOpaque = true
        background = UiStyle.Colors.surface()
        viewport.background = UiStyle.Colors.surface()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (!canExpand(item)) return
            toggle()
        }
    }

    private val mouse = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
            setHover(true)
        }

        override fun mouseExited(e: MouseEvent) {
            if (inside(e)) return
            setHover(false)
        }
    }

    init {
        layout = BorderLayout()
        isOpaque = false
        center.add(title, BorderLayout.WEST)
        center.add(sub, BorderLayout.CENTER)
        header.add(glyph, BorderLayout.WEST)
        header.add(center, BorderLayout.CENTER)
        header.add(controls, BorderLayout.EAST)
        root.add(header, BorderLayout.NORTH)

        listOf(header, glyph, title, sub, state, arrow, center, controls).forEach {
            bind(it)
            it.addMouseListener(click)
        }
        text.text = preview(item)
        applyStyle(SessionStyle.current())
        add(root, BorderLayout.CENTER)
        sync()
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = header.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        val was = item.name
        item = content
        var changed = false
        if (was != content.name || !canExpand(content)) changed = detach() || changed
        changed = sync() || changed
        changed = syncBody() || changed
        if (changed) refresh()
    }

    fun labelText(): String = listOf(title.text, sub.text, state.text).filter { it.isNotBlank() }.joinToString(" ")

    fun commandText(): String = command(item)

    fun outputText(): String = output(item)

    fun bodyText(): String = body(item)

    internal fun previewText(): String = text.text

    fun isExpanded(): Boolean = bodyVisible()

    fun hasToggle(): Boolean = arrow.isVisible

    internal fun bodyFont() = text.font

    internal fun titleFont() = title.font

    internal fun subtitleFont() = sub.font

    internal fun stateFont() = state.font

    internal fun bodyEditable() = text.isEditable

    internal fun bodyCaretVisible() = text.caret.isVisible

    internal fun bodyVisible() = scroll.parent === root

    internal fun controlCount() = if (arrow.isVisible) 1 else 0

    internal fun horizontalPolicy() = scroll.horizontalScrollBarPolicy

    internal fun bodyWrap() = text.lineWrap

    internal fun bodyMaxRows() = UiStyle.Card.LINES

    internal fun bodyCreated() = true

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        var changed = false
        changed = setFont(title, style.boldEditorFont) || changed
        changed = setFont(sub, style.smallEditorFont) || changed
        changed = setFont(state, style.smallEditorFont) || changed
        changed = setFont(text, style.transcriptFont) || changed
        if (changed) refresh()
    }

    fun toggle() {
        if (!canExpand(item)) return
        var changed = if (bodyVisible()) detach() else attach()
        changed = syncArrow() || changed
        if (changed) refresh()
    }

    private fun setHover(value: Boolean) {
        val color = if (value) UiStyle.Colors.headerHover() else UiStyle.Colors.header()
        if (same(header.background, color)) return
        header.background = color
        header.repaint()
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, header)
        return header.contains(point)
    }

    private fun bind(component: Component) {
        component.addMouseListener(mouse)
    }

    private fun sync(): Boolean {
        val expand = canExpand(item)
        val cursor = if (expand) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        var changed = false
        changed = syncCursor(cursor) || changed
        changed = setVisible(arrow, expand) || changed
        changed = setVisible(state, !expand) || changed
        changed = syncArrow() || changed
        changed = syncLabels() || changed
        changed = setForeground(text, bodyColor()) || changed
        return changed
    }

    private fun syncLabels(): Boolean {
        var changed = false
        changed = setIcon(glyph, icon(item)) || changed
        changed = setForeground(glyph, color(item)) || changed
        changed = setText(title, title(item)) || changed
        changed = setText(sub, subtitle(item)) || changed
        changed = setForeground(title, titleColor(item)) || changed
        changed = setText(state, stateText(item)) || changed
        changed = setForeground(state, color(item)) || changed
        return changed
    }

    private fun syncArrow(): Boolean {
        val icon = if (bodyVisible()) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        return setIcon(arrow, icon)
    }

    private fun syncBody(): Boolean {
        var changed = false
        val value = preview(item)
        if (text.text != value) {
            text.text = value
            text.caretPosition = 0
            changed = true
        }
        changed = setForeground(text, bodyColor()) || changed
        return changed
    }

    private fun attach(): Boolean {
        if (bodyVisible()) return false
        syncBody()
        root.add(scroll, BorderLayout.CENTER)
        return true
    }

    private fun detach(): Boolean {
        val attached = scroll.parent === root
        if (attached) root.remove(scroll)
        return attached
    }

    private fun syncCursor(cursor: Cursor): Boolean {
        var changed = false
        listOf(header, glyph, title, sub, state, arrow, center, controls).forEach {
            if (it.cursor?.type != cursor.type) {
                it.cursor = cursor
                changed = true
            }
        }
        return changed
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun bodyColor() = if (item.state == ToolExecState.ERROR) UiStyle.Colors.error() else UiStyle.Colors.fg()

    private fun bodyMaxHeight(): Int {
        return text.getFontMetrics(text.font).height * bodyMaxRows() + UiStyle.Card.scrollChrome()
    }

    override fun dumpLabel() = "ToolView#$contentId(${labelText()})"
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
    ToolExecState.PENDING -> UiStyle.Colors.weak()
    ToolExecState.RUNNING -> UiStyle.Colors.running()
    ToolExecState.COMPLETED -> UiStyle.Colors.weak()
    ToolExecState.ERROR -> UiStyle.Colors.error()
}

private fun titleColor(tool: Tool) = if (tool.state == ToolExecState.ERROR) {
    UiStyle.Colors.error()
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
    val path = tool.input["filePath"] ?: tool.input["path"] ?: tool.title ?: return tool.name
    return tail(path).ifBlank { path }
}

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
    if (tool.name == "bash") {
        return command(tool).isNotBlank() || output(tool).isNotBlank() || !tool.error.isNullOrBlank()
    }
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
        val rem = UiStyle.Size.toolBodyLimit() - text.length
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
