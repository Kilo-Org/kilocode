@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.openSessionLink
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.popup.HeaderPopupBody
import ai.kilocode.client.session.ui.popup.HeaderPopupRequest
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.AbstractSessionPartView
import ai.kilocode.client.session.views.base.PartHeader
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Font
import java.awt.Rectangle
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.SwingUtilities

/** Renders reasoning as a secondary collapsible block. */
class ReasoningView(
    reasoning: Reasoning,
    private val openFile: SessionFileOpener = { _, _ -> },
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val parts: ReasoningParts = reasoningParts(selection),
) :
    AbstractSessionPartView(
        parts.header,
        { parts.scroll(openFile, openUrl) },
        expanded = reasoning.content.isNotBlank() && !reasoning.done,
        compact = true,
    ) {

    override val contentId: String = reasoning.id

    /** Lazily creates, registers, populates, and styles the editor-backed body on first access. */
    val md: MdView
        @RequiresEdt
        get() {
            val fresh = !parts.bodyCreated()
            val view = parts.md(openFile, openUrl)
            if (!fresh) return view
            registerBody(view)
            view.set(source)
            view.applyStyle(style)
            apply(view)
            return view
        }

    private var style = SessionEditorStyle.current()
    private var source = reasoning.content.toString()
    private var done = reasoning.done
    private var registered = false
    private var following = false
    private var pinned = false

    init {
        applyStyle(style)
        if (bodyVisible()) syncBody()
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
    override fun update(content: Content) {
        if (content !is Reasoning) return
        var changed = false
        val next = content.content.toString()
        val follow = tailVisible()
        val finishing = !done && content.done
        if (done != content.done) {
            done = content.done
            changed = true
        }
        if (source != next) {
            source = next
            if (parts.bodyCreated()) {
                md.set(source)
                followTail(follow)
            }
            changed = true
        }
        if (finishing && !pinned) {
            changed = collapse() || changed
            changed = releaseBody() || changed
        }
        changed = sync() || changed
        if (changed) refresh()
    }

    /** Detaches and disposes the markdown body so its editors are released when reasoning finishes. */
    @RequiresEdt
    private fun releaseBody(): Boolean {
        if (!parts.bodyCreated()) return false
        val detached = discardBody()
        Disposer.dispose(parts.md(openFile, openUrl))
        parts.reset()
        registered = false
        return detached
    }

    @RequiresEdt
    override fun userToggled() {
        pinned = true
    }

    @RequiresEdt
    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        val follow = tailVisible()
        source += delta
        if (parts.bodyCreated()) {
            md.append(delta)
            followTail(follow)
        }
        val changed = sync()
        if (changed || bodyVisible()) refresh()
    }

    @RequiresEdt
    fun markdown(): String = source
    @RequiresEdt
    fun hasToggle(): Boolean = arrow.isVisible
    @RequiresEdt
    fun headerText(): String = parts.title.text
    @RequiresEdt
    internal fun headerFont() = parts.title.font
    @RequiresEdt
    internal fun bodyVisible() = parts.scrollOrNull?.parent === this
    @RequiresEdt
    internal fun horizontalPolicy() = parts.scrollOrNull?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    @RequiresEdt
    internal fun bodyMaxRows() = SessionUiStyle.View.Reasoning.BODY_LINES
    @RequiresEdt
    internal fun bodyCreated() = parts.bodyCreated()
    @RequiresEdt
    internal fun bodyScrollValue() = parts.scrollOrNull?.verticalScrollBar?.value ?: 0
    @RequiresEdt
    internal fun bodyScrollBottom() = parts.scrollOrNull?.verticalScrollBar?.let { it.maximum - it.visibleAmount } ?: 0

    @RequiresEdt
    override fun headerPopup(): HeaderPopupRequest? =
        popup("part", "reasoning", source.isNotBlank()) { buildPopupBody(source) }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        if (parts.title.font != style.smallEditorFont) {
            parts.title.font = style.smallEditorFont
            changed = true
        }
        changed = applyBodyStyle() || changed
        if (changed) refresh()
    }

    @RequiresEdt
    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + expandedGap() + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    private fun canExpand(): Boolean = source.isNotBlank()

    private fun sync(): Boolean {
        var changed = false
        val visible = source.isNotBlank()
        if (isVisible != visible) {
            isVisible = visible
            changed = true
        }
        changed = syncExpandable(canExpand()) || changed
        if (visible && !done && !parts.bodyCreated()) {
            changed = expand() || changed
            changed = syncExpandable(canExpand()) || changed
        }
        return changed
    }

    private fun apply(md: MdView): Boolean {
        var changed = false
        val font = style.smallEditorFont.deriveFont(Font.ITALIC)
        changed = md.font != font || changed
        md.font = font
        changed = md.codeFont != style.editorFamily || changed
        md.codeFont = style.editorFamily
        changed = md.foreground.rgb != SessionUiStyle.Text.Secondary.foreground().rgb || changed
        md.foreground = SessionUiStyle.Text.Secondary.foreground()
        return changed
    }

    @RequiresEdt
    private fun syncBody() {
        val md = md
        registerBody(md)
        md.set(source)
        followTail(true)
    }

    private fun applyBodyStyle(): Boolean {
        if (!parts.bodyCreated()) return false
        val md = md
        registerBody(md)
        md.applyStyle(style)
        return apply(md)
    }

    private fun registerBody(md: MdView) {
        if (registered) return
        registered = true
        Disposer.register(this, md)
    }

    @RequiresEdt
    private fun buildPopupBody(text: String): HeaderPopupBody {
        val md = MdViewFactory.create(style, null).apply {
            addLinkListener { openSessionLink(it, openFile, openUrl) }
        }
        md.applyStyle(style)
        md.font = style.smallEditorFont.deriveFont(Font.ITALIC)
        md.codeFont = style.editorFamily
        md.foreground = SessionUiStyle.Text.Secondary.foreground()
        md.background = SessionUiStyle.Colors.codeBlockBackground()
        md.component.border = JBUI.Borders.empty()
        md.set(text)
        // The shared popup wrapper (HeaderPopupBody) provides the scroll pane, so pass the content
        // panel directly instead of nesting a second scroll pane here.
        val panel = TrackPanel().apply {
            isOpaque = true
            background = SessionUiStyle.Colors.codeBlockBackground()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.Reasoning.BODY_VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.Reasoning.BODY_HORIZONTAL_PADDING),
            )
            add(md.component, BorderLayout.CENTER)
        }
        return HeaderPopupBody(panel, md, SessionUiStyle.Colors.codeBlockBackground())
    }

    private fun bodyMaxHeight(): Int {
        if (!parts.bodyCreated()) return 0
        val md = md
        return md.component.getFontMetrics(md.font).height * bodyMaxRows() +
            JBUI.scale(SessionUiStyle.View.Layout.BODY_EXTRA_HEIGHT)
    }

    @RequiresEdt
    private fun tailVisible(): Boolean {
        if (!bodyVisible()) return false
        val scroll = parts.scrollOrNull ?: return false
        val bar = scroll.verticalScrollBar
        return bar.value >= bar.maximum - bar.visibleAmount
    }

    @RequiresEdt
    private fun followTail(follow: Boolean) {
        if (!follow || !bodyVisible() || following) return
        val scroll = parts.scrollOrNull ?: return
        following = true
        SwingUtilities.invokeLater {
            following = false
            if (!bodyVisible()) return@invokeLater
            val bar = scroll.verticalScrollBar
            bar.value = bar.maximum - bar.visibleAmount
        }
    }

    override fun dumpLabel(): String {
        val state = if (bodyVisible()) "open" else "closed"
        return "ReasoningView#$contentId($state)"
    }
}

class ReasoningParts(
    val header: PartHeader,
    val title: JBLabel,
    val icon: JBLabel,
    private val selection: SessionSelection?,
) {
    private var body: ReasoningBody? = null
    val scrollOrNull: JBScrollPane? get() = body?.scroll

    fun bodyCreated() = body != null

    fun reset() {
        body = null
    }

    fun md(openFile: SessionFileOpener, openUrl: (String) -> Unit): MdView = body(openFile, openUrl).md

    fun scroll(openFile: SessionFileOpener, openUrl: (String) -> Unit): JBScrollPane = body(openFile, openUrl).scroll

    private fun body(openFile: SessionFileOpener, openUrl: (String) -> Unit): ReasoningBody {
        val item = body
        if (item != null) return item
        val md = MdViewFactory.create(SessionEditorStyle.current(), selection).apply {
            opaque = false
            addLinkListener { openSessionLink(it, openFile, openUrl) }
        }
        val panel = TrackPanel().apply {
            isOpaque = true
            background = SessionUiStyle.Colors.codeBlockBackground()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.Reasoning.BODY_VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.Reasoning.BODY_HORIZONTAL_PADDING),
            )
            add(md.component, BorderLayout.CENTER)
        }
        val scroll = JBScrollPane(panel).apply {
            border = JBUI.Borders.empty()
            isOpaque = true
            background = SessionUiStyle.Colors.codeBlockBackground()
            viewport.background = SessionUiStyle.Colors.codeBlockBackground()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        return ReasoningBody(md, panel, scroll).also { body = it }
    }
}

class ReasoningBody(
    val md: MdView,
    val panel: TrackPanel,
    val scroll: JBScrollPane,
)

private fun reasoningParts(selection: SessionSelection? = null): ReasoningParts {
    val title = JBLabel(KiloBundle.message("session.part.reasoning")).apply { foreground = SessionUiStyle.Text.Secondary.foreground() }
    val icon = JBLabel(SessionViewIcons.brain).apply { foreground = SessionUiStyle.Text.Secondary.foreground() }
    val header = PartHeader().apply {
        leading(icon)
        left(title)
    }
    return ReasoningParts(header, title, icon, selection)
}

class TrackPanel : JPanel(BorderLayout()), Scrollable {
    override fun getScrollableTracksViewportWidth() = true
    override fun getScrollableTracksViewportHeight() = false
    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize
    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT)
    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = visibleRect.height
}
