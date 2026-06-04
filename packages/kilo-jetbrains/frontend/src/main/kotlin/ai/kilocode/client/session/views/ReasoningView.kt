@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Font
import java.awt.Rectangle
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable

/** Renders reasoning as a secondary collapsible block. */
class ReasoningView(
    reasoning: Reasoning,
    private val openUrl: (String) -> Unit = {},
    private val selection: SessionSelection? = null,
    private val parts: ReasoningParts = reasoningParts(selection),
) :
    SecondarySessionPartView(parts.header, { parts.scroll(openUrl) }) {

    override val contentId: String = reasoning.id

    val md: MdView
        get() {
            val fresh = !parts.bodyCreated()
            val view = parts.md(openUrl)
            if (!fresh) return view
            registerBody(view)
            view.set(source)
            view.applyStyle(style)
            apply(view)
            return view
        }

    private var style = SessionEditorStyle.current()
    private var source = reasoning.content.toString()
    private var registered = false

    init {
        bindHeader(parts.title, parts.icon)
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

    override fun update(content: Content) {
        if (content !is Reasoning) return
        var changed = false
        val next = content.content.toString()
        if (source != next) {
            source = next
            if (parts.bodyCreated()) md.set(source)
            changed = true
        }
        changed = sync() || changed
        if (changed) refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        source += delta
        if (parts.bodyCreated()) md.append(delta)
        val changed = sync()
        if (changed || bodyVisible()) refresh()
    }

    fun markdown(): String = source
    fun hasToggle(): Boolean = arrow.isVisible
    fun headerText(): String = parts.title.text
    internal fun headerFont() = parts.title.font
    internal fun bodyVisible() = parts.scrollOrNull?.parent === this
    internal fun horizontalPolicy() = parts.scrollOrNull?.horizontalScrollBarPolicy ?: ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    internal fun bodyMaxRows() = SessionUiStyle.View.Reasoning.BODY_LINES
    internal fun bodyCreated() = parts.bodyCreated()

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

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = row.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    private fun canExpand(): Boolean = source.isNotBlank()

    private fun sync(): Boolean = syncExpandable(canExpand())

    private fun apply(md: MdView): Boolean {
        var changed = false
        val font = style.smallEditorFont.deriveFont(Font.ITALIC)
        changed = md.font != font || changed
        md.font = font
        changed = md.codeFont != style.editorFamily || changed
        md.codeFont = style.editorFamily
        changed = md.foreground.rgb != UiStyle.Colors.weak().rgb || changed
        md.foreground = UiStyle.Colors.weak()
        return changed
    }

    private fun syncBody() {
        val md = md
        registerBody(md)
        md.set(source)
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

    private fun bodyMaxHeight(): Int {
        if (!parts.bodyCreated()) return 0
        val md = md
        return md.component.getFontMetrics(md.font).height * bodyMaxRows() +
            JBUI.scale(SessionUiStyle.View.SESSION_VIEW_BODY_EXTRA_HEIGHT)
    }

    override fun dumpLabel(): String {
        val state = if (bodyVisible()) "open" else "closed"
        return "ReasoningView#$contentId($state)"
    }
}

class ReasoningParts(
    val header: JPanel,
    val title: JBLabel,
    val icon: JBLabel,
    private val selection: SessionSelection?,
) {
    private var body: ReasoningBody? = null
    val scrollOrNull: JBScrollPane? get() = body?.scroll

    fun bodyCreated() = body != null

    fun md(openUrl: (String) -> Unit): MdView = body(openUrl).md

    fun scroll(openUrl: (String) -> Unit): JBScrollPane = body(openUrl).scroll

    private fun body(openUrl: (String) -> Unit): ReasoningBody {
        val item = body
        if (item != null) return item
        val md = MdViewFactory.create(SessionEditorStyle.current(), selection).apply {
            opaque = false
            addLinkListener { openUrl(it.href) }
        }
        val panel = TrackPanel().apply {
            isOpaque = true
            background = SessionUiStyle.View.surface()
            border = JBUI.Borders.empty(
                JBUI.scale(SessionUiStyle.View.SESSION_VIEW_VERTICAL_PADDING),
                JBUI.scale(SessionUiStyle.View.SESSION_VIEW_HORIZONTAL_PADDING),
            )
            add(md.component, BorderLayout.CENTER)
        }
        val scroll = JBScrollPane(panel).apply {
            border = SessionUiStyle.View.topOutline()
            isOpaque = true
            background = SessionUiStyle.View.surface()
            viewport.background = SessionUiStyle.View.surface()
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
    val title = JBLabel(KiloBundle.message("session.part.reasoning")).apply { foreground = UiStyle.Colors.weak() }
    val icon = JBLabel(AllIcons.General.InspectionsEye).apply { foreground = UiStyle.Colors.weak() }
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.SESSION_VIEW_GAP), 0)).apply {
        isOpaque = false
        add(icon, BorderLayout.WEST)
        add(title, BorderLayout.CENTER)
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
