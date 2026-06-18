package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.actionSystem.DataSink
import com.intellij.openapi.actionSystem.UiDataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

/** Renders non-read tool calls with VS Code-inspired rows/cards. */
class ToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts = toolParts(tool, mode = ToolBodyMode.EDITOR),
) : SecondarySessionPartView(parts.header, { parts.scroll(tool) }), UiDataProvider {

    override val contentId: String = tool.id

    private var item = tool
    private var style = SessionEditorStyle.current()
    private var registered = false
    private var disposed = false

    init {
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        applyStyle(style)
        sync()
    }

    override fun uiDataSnapshot(sink: DataSink) {
        selection?.provideCopy(sink) { parts.content?.text ?: fallbackText() }
    }

    private fun fallbackText() = listOf(commandText(), outputText()).filter { it.isNotBlank() }.joinToString("\n\n")

    @RequiresEdt
    override fun expand(): Boolean {
        val changed = super.expand()
        if (!changed) return false
        syncBody()
        applyBodyStyle()
        return true
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + bodyMaxHeight()
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
    fun outputText(): String = output(item)
    @RequiresEdt
    fun bodyText(): String = body(item)
    @RequiresEdt
    internal fun previewText(): String = parts.content?.text ?: preview(item)
    @RequiresEdt
    fun hasToggle(): Boolean = arrow.isVisible
    @RequiresEdt
    internal fun bodyFont() = parts.content?.font ?: style.editorFont
    @RequiresEdt
    internal fun titleFont() = parts.title.font
    @RequiresEdt
    internal fun subtitleFont() = parts.sub.font
    @RequiresEdt
    internal fun stateFont() = parts.state.font
    @RequiresEdt
    internal fun bodyEditable() = parts.content?.editable ?: false
    @RequiresEdt
    internal fun bodyCaretVisible() = parts.content?.caretVisible ?: false
    @RequiresEdt
    internal fun bodyVisible() = parts.scroll?.parent === this
    @RequiresEdt
    internal fun controlCount() = if (arrow.isVisible) 1 else 0
    @RequiresEdt
    internal fun horizontalPolicy() = parts.scroll?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    @RequiresEdt
    internal fun verticalPolicy() = parts.scroll?.verticalScrollBarPolicy ?: ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
    @RequiresEdt
    internal fun bodyWrap() = parts.content?.lineWrap ?: false
    @RequiresEdt
    internal fun bodyMaxRows() = SessionUiStyle.View.Tool.BODY_LINES
    @RequiresEdt
    internal fun bodyCreated() = parts.bodyCreated()
    @RequiresEdt
    internal fun bodyEditor() = parts.content?.editor

    @RequiresEdt
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
        val body = parts.content
        if (body != null && body.foreground != bodyColor()) {
            body.foreground = bodyColor()
            changed = true
        }
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
        val body = parts.content ?: return false
        val value = preview(item)
        if (body.text != value) {
            body.text = value
            changed = true
        }
        if (body.foreground != bodyColor()) {
            body.foreground = bodyColor()
            changed = true
        }
        return changed
    }

    private fun applyBodyStyle(): Boolean {
        val body = parts.content ?: return false
        if (!disposed) {
            Disposer.register(this, body)
            disposed = true
        }
        if (!registered && selection != null && parts.scroll?.parent != null) {
            registered = true
            body.register(selection, this)
        }
        return body.applyStyle(style)
    }

    private fun bodyColor() = if (item.state == ToolExecState.ERROR) UiStyle.Colors.errorLabelForeground() else UiStyle.Colors.fg()

    private fun bodyMaxHeight(): Int {
        val body = parts.content ?: return 0
        return body.lineHeight() * bodyMaxRows() +
            JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "ToolView#$contentId(${labelText()})"
}
