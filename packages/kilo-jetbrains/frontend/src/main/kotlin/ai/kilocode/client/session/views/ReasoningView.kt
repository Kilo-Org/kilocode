@file:Suppress("TooManyFunctions")

package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.md.MdView
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.Rectangle
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.SwingUtilities

/** Renders reasoning as a VS Code-style collapsible block. */
class ReasoningView(reasoning: Reasoning) : PartView() {

    override val contentId: String = reasoning.id

    val md: MdView = MdView.html()

    private val arrow = JBLabel()
    private val body = TrackPanel().apply {
        isOpaque = true
        background = UiStyle.Colors.surface()
        border = UiStyle.Card.bodyInsets()
    }
    private val scroll = JBScrollPane(body).apply {
        border = UiStyle.Card.divider()
        isOpaque = true
        background = UiStyle.Colors.surface()
        viewport.background = UiStyle.Colors.surface()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }
    private val header = JPanel(UiStyle.Card.layout()).apply {
        isOpaque = true
        background = UiStyle.Colors.header()
        border = UiStyle.Card.headerInsets()
    }
    private val title = JBLabel(KiloBundle.message("session.part.reasoning")).apply {
        foreground = UiStyle.Colors.weak()
    }
    private val icon = JBLabel(AllIcons.General.InspectionsEye).apply {
        foreground = UiStyle.Colors.weak()
    }

    private var style = SessionStyle.current()
    private var source = reasoning.content.toString()

    private val click = object : MouseAdapter() {
        override fun mouseClicked(e: MouseEvent) {
            if (!canExpand()) return
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
        border = UiStyle.Card.border()

        val left = JPanel(UiStyle.Card.layout()).apply {
            isOpaque = false
            add(icon, BorderLayout.WEST)
            add(title, BorderLayout.CENTER)
        }

        header.add(left, BorderLayout.CENTER)
        header.add(arrow, BorderLayout.EAST)
        listOf(header, left, title, icon, arrow).forEach {
            it.addMouseListener(click)
            it.addMouseListener(mouse)
        }

        applyStyle(SessionStyle.current())
        md.opaque = false
        md.set(source)
        body.add(md.component, BorderLayout.CENTER)

        add(header, BorderLayout.NORTH)
        if (canExpand()) add(scroll, BorderLayout.CENTER)
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
        changed = syncBody() || changed
        changed = sync() || changed
        if (changed) refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        source += delta
        md.append(delta)
        var changed = syncBody()
        changed = sync() || changed
        if (changed || bodyVisible()) refresh()
    }

    fun markdown(): String = source

    fun isExpanded(): Boolean = bodyVisible()

    fun hasToggle(): Boolean = arrow.isVisible

    fun headerText(): String = title.text

    internal fun headerFont() = title.font

    internal fun bodyVisible() = scroll.parent === this

    internal fun horizontalPolicy() = scroll.horizontalScrollBarPolicy

    internal fun bodyMaxRows() = UiStyle.Card.REASONING_LINES

    internal fun bodyCreated() = true

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        var changed = false
        if (title.font != style.smallEditorFont) {
            title.font = style.smallEditorFont
            changed = true
        }
        changed = apply(md) || changed
        if (changed) refresh()
    }

    fun toggle() {
        if (!canExpand()) return
        var changed = if (bodyVisible()) collapse() else expand()
        changed = sync() || changed
        if (changed) refresh()
    }

    override fun getPreferredSize(): Dimension {
        val size = super.getPreferredSize()
        if (!bodyVisible()) return size
        val height = header.preferredSize.height + bodyMaxHeight()
        return Dimension(size.width, minOf(size.height, height))
    }

    private fun setHover(value: Boolean) {
        val color = if (value) UiStyle.Colors.headerHover() else UiStyle.Colors.header()
        if (header.background?.rgb == color.rgb) return
        header.background = color
        header.repaint()
    }

    private fun inside(e: MouseEvent): Boolean {
        val point = SwingUtilities.convertPoint(e.component, e.point, header)
        return header.contains(point)
    }

    private fun canExpand(): Boolean = source.isNotBlank()

    private fun sync(): Boolean {
        val expand = canExpand()
        if (!expand) collapse()
        var changed = false
        changed = setVisible(arrow, expand) || changed
        changed = syncArrow() || changed
        val cursor = if (expand) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
        listOf(header, title, icon, arrow).forEach {
            if (it.cursor?.type != cursor.type) {
                it.cursor = cursor
                changed = true
            }
        }
        return changed
    }

    private fun syncBody(): Boolean {
        if (!canExpand()) return collapse()
        if (bodyVisible()) return false
        return expand()
    }

    private fun setVisible(component: JBLabel, visible: Boolean): Boolean {
        if (component.isVisible == visible) return false
        component.isVisible = visible
        return true
    }

    private fun setIcon(label: JBLabel, icon: javax.swing.Icon): Boolean {
        if (label.icon === icon) return false
        label.icon = icon
        return true
    }

    private fun syncArrow(): Boolean {
        val icon = if (bodyVisible()) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        return setIcon(arrow, icon)
    }

    private fun expand(): Boolean {
        if (bodyVisible()) return false
        add(scroll, BorderLayout.CENTER)
        return true
    }

    private fun collapse(): Boolean {
        val attached = scroll.parent === this
        if (attached) remove(scroll)
        return attached
    }

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

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun bodyMaxHeight(): Int = md.component.getFontMetrics(md.font).height * bodyMaxRows() +
        UiStyle.Card.scrollChrome()

    override fun dumpLabel(): String {
        val state = if (bodyVisible()) "open" else "closed"
        return "ReasoningView#$contentId($state)"
    }
}

private class TrackPanel : JPanel(BorderLayout()), Scrollable {
    override fun getScrollableTracksViewportWidth() = true
    override fun getScrollableTracksViewportHeight() = false
    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize
    override fun getScrollableUnitIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = UiStyle.Gap.scroll()
    override fun getScrollableBlockIncrement(
        visibleRect: Rectangle,
        orientation: Int,
        direction: Int,
    ) = visibleRect.height
}
