@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import com.intellij.icons.AllIcons
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
    openUrl: (String) -> Unit = {},
    private val parts: ReasoningParts = reasoningParts(),
) :
    SecondarySessionPartView(parts.header, parts.scroll) {

    override val contentId: String = reasoning.id

    val md: MdView = parts.md

    private var style = SessionEditorStyle.current()
    private var source = reasoning.content.toString()

    init {
        bindHeader(parts.title, parts.icon)
        applyStyle(style)
        md.opaque = false
        md.addLinkListener { openUrl(it.href) }
        md.set(source)
        parts.panel.add(md.component, BorderLayout.CENTER)
        sync()
    }

    override fun update(content: Content) {
        if (content !is Reasoning) return
        var changed = false
        val next = content.content.toString()
        if (source != next) {
            source = next
            md.set(source)
            changed = true
        }
        changed = sync() || changed
        if (changed) refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        source += delta
        md.append(delta)
        val changed = sync()
        if (changed || bodyVisible()) refresh()
    }

    fun markdown(): String = source
    fun hasToggle(): Boolean = arrow.isVisible
    fun headerText(): String = parts.title.text
    internal fun headerFont() = parts.title.font
    internal fun bodyVisible() = parts.scroll.parent === this
    internal fun horizontalPolicy() = parts.scroll.horizontalScrollBarPolicy
    internal fun bodyMaxRows() = SessionUiStyle.View.Reasoning.BODY_LINES
    internal fun bodyCreated() = true

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        var changed = false
        if (parts.title.font != style.smallEditorFont) {
            parts.title.font = style.smallEditorFont
            changed = true
        }
        changed = apply(md) || changed
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

    private fun bodyMaxHeight(): Int = md.component.getFontMetrics(md.font).height * bodyMaxRows() +
        JBUI.scale(SessionUiStyle.View.CARD_BODY_EXTRA_HEIGHT)

    override fun dumpLabel(): String {
        val state = if (bodyVisible()) "open" else "closed"
        return "ReasoningView#$contentId($state)"
    }
}

class ReasoningParts(
    val md: MdView,
    val panel: TrackPanel,
    val scroll: JBScrollPane,
    val header: JPanel,
    val title: JBLabel,
    val icon: JBLabel,
)

private fun reasoningParts(): ReasoningParts {
    val md = MdView.html()
    val panel = TrackPanel().apply {
        isOpaque = true
        background = SessionUiStyle.View.surface()
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING),
        )
    }
    val scroll = JBScrollPane(panel).apply {
        border = SessionUiStyle.View.cardTop()
        isOpaque = true
        background = SessionUiStyle.View.surface()
        viewport.background = SessionUiStyle.View.surface()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }
    val title = JBLabel(KiloBundle.message("session.part.reasoning")).apply { foreground = UiStyle.Colors.weak() }
    val icon = JBLabel(AllIcons.General.InspectionsEye).apply { foreground = UiStyle.Colors.weak() }
    val header = JPanel(BorderLayout(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP), 0)).apply {
        isOpaque = false
        add(icon, BorderLayout.WEST)
        add(title, BorderLayout.CENTER)
    }
    return ReasoningParts(md, panel, scroll, header, title, icon)
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
