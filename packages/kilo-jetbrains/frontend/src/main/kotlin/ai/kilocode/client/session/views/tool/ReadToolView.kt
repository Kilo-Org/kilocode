package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

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
        item = content
        var changed = sync()
        changed = syncBody() || changed
        if (changed) refresh()
    }

    @RequiresEdt
    fun labelText(): String = listOf(parts.title.text, subtitleText(parts), parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")
    @RequiresEdt
    fun bodyText(): String = body(item)
    @RequiresEdt
    internal fun bodyVisible() = parts.scroll?.parent === this
    @RequiresEdt
    internal fun hasToggle() = arrow.isVisible
    @RequiresEdt
    internal fun horizontalPolicy() = parts.scroll?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    @RequiresEdt
    internal fun bodyMaxRows() = SessionUiStyle.View.Tool.BODY_LINES
    @RequiresEdt
    internal fun bodyFont() = parts.text?.font ?: style.transcriptFont
    @RequiresEdt
    internal fun bodyCreated() = parts.bodyCreated()
    @RequiresEdt
    internal fun bodyWrap() = parts.text?.lineWrap ?: false
    @RequiresEdt
    internal fun bodyEditor() = parts.content?.editor
    @RequiresEdt
    internal fun linkVisible() = parts.link.isVisible
    @RequiresEdt
    internal fun linkText() = parts.label
    @RequiresEdt
    internal fun linkMarkup() = parts.link.text ?: ""
    @RequiresEdt
    internal fun linkForeground() = parts.link.foreground
    @RequiresEdt
    internal fun linkFont() = parts.link.font
    @RequiresEdt
    internal fun subtitleForeground() = parts.sub.foreground
    @RequiresEdt
    internal fun subtitleFont() = parts.sub.font
    @RequiresEdt
    internal fun linkHref() = parts.href
    @RequiresEdt
    internal fun openLink() = parts.openLink()

    @RequiresEdt
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
            JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "ReadToolView#$contentId(${labelText()})"
}
