package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.Icon

abstract class BaseSearchToolView(
    tool: Tool,
    private val selection: SessionSelection? = null,
    private val parts: ToolParts,
    private val repo: String? = null,
) : SecondarySessionPartView(parts.header, { parts.scroll(tool) }) {

    override val contentId: String = tool.id

    protected var item = tool
    private var style = SessionEditorStyle.current()
    private var registered = false
    private var disposed = false

    protected abstract fun toolIcon(tool: Tool): Icon
    protected abstract fun toolTitle(tool: Tool): String
    protected abstract fun targets(tool: Tool, repo: String?): List<String>
    protected abstract fun viewName(): String

    init {
        bindHeader(parts.glyph, parts.title, parts.sub, parts.state, parts.center, parts.controls, parts.slot)
        parts.targets.forEach { bindHeader(it) }
        applyStyle(style)
        sync()
    }

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
        item = content
        var changed = sync()
        changed = syncBody() || changed
        if (changed) refresh()
    }

    @RequiresEdt
    fun labelText(): String = listOf(parts.title.text).plus(targetTexts()).plus(parts.state.text)
        .filter { it.isNotBlank() }
        .joinToString(" ")

    @RequiresEdt
    fun bodyText(): String = body(item)
    @RequiresEdt
    internal fun targetTexts(): List<String> = parts.targets.map { it.text }.filter { it.isNotBlank() }
    @RequiresEdt
    internal fun targetVisible(index: Int): Boolean = parts.targets.getOrNull(index)?.isVisible ?: false
    @RequiresEdt
    internal fun bodyVisible() = parts.scroll?.parent === this
    @RequiresEdt
    internal fun hasToggle() = arrow.isVisible
    @RequiresEdt
    internal fun bodyFont() = parts.content?.font ?: style.editorFont
    @RequiresEdt
    internal fun titleFont() = parts.title.font
    @RequiresEdt
    internal fun targetFont(index: Int) = parts.targets.getOrNull(index)?.font ?: style.regularFont
    @RequiresEdt
    internal fun stateFont() = parts.state.font
    @RequiresEdt
    internal fun bodyCreated() = parts.bodyCreated()
    @RequiresEdt
    internal fun scrollComponent() = parts.scroll
    @RequiresEdt
    internal fun bodyEditor() = parts.content?.editor
    @RequiresEdt
    internal fun horizontalPolicy() = parts.scroll?.horizontalScrollBarPolicy
    @RequiresEdt
    internal fun verticalPolicy() = parts.scroll?.verticalScrollBarPolicy
    @RequiresEdt
    internal fun bodyWrap() = parts.content?.lineWrap ?: false
    @RequiresEdt
    internal fun headerComponent() = parts.header
    @RequiresEdt
    internal fun centerComponent() = parts.center
    @RequiresEdt
    internal fun targetComponents() = parts.targets

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        changed = setFont(parts.title, style.boldEditorFont) || changed
        changed = setFont(parts.sub, style.smallEditorFont) || changed
        parts.targets.forEach { changed = setFont(it, style.regularFont) || changed }
        changed = setFont(parts.state, style.smallEditorFont) || changed
        changed = applyBodyStyle() || changed
        if (changed) refresh()
    }

    private fun sync(): Boolean {
        val expand = canExpand(item)
        var changed = false
        changed = syncExpandable(expand) || changed
        changed = setVisible(parts.state, item.state != ToolExecState.COMPLETED) || changed
        changed = setIcon(parts.glyph, toolIcon(item)) || changed
        changed = setForeground(parts.glyph, color(item)) || changed
        changed = setText(parts.title, toolTitle(item)) || changed
        changed = setForeground(parts.title, titleColor(item)) || changed
        changed = setForeground(parts.sub, UiStyle.Colors.weak()) || changed
        changed = syncTargets() || changed
        changed = setText(parts.state, stateText(item)) || changed
        changed = setForeground(parts.state, color(item)) || changed
        val body = parts.content
        if (body != null && body.foreground != bodyColor()) {
            body.foreground = bodyColor()
            changed = true
        }
        return changed
    }

    private fun syncTargets(): Boolean {
        val values = targets(item, repo)
        var changed = false
        parts.targets.forEachIndexed { index, label ->
            val text = values.getOrNull(index) ?: ""
            changed = setVisible(label, text.isNotBlank()) || changed
            changed = setTargetText(label, text) || changed
            changed = setForeground(label, UiStyle.Colors.fg()) || changed
        }
        return changed
    }

    private fun syncBody(): Boolean {
        val body = parts.content ?: return false
        val value = plainBody(item)
        if (body.text != value) {
            body.text = value
            return true
        }
        return false
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
        return body.lineHeight() * SessionUiStyle.View.Tool.BODY_LINES +
            JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel() = "${viewName()}#$contentId(${labelText()})"
}
