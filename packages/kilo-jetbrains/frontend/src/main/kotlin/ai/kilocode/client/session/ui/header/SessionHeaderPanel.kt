package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionHeaderSnapshot
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.TokensDto
import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.SwingTextTrimmer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Point
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import java.awt.event.MouseWheelEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JViewport
import javax.swing.SwingUtilities

class SessionHeaderPanel(
    private val controller: SessionController,
    parent: Disposable,
    private val readonly: Boolean = false,
    /** Whether the shared agent board icon should show, re-derived on every [update]. */
    private val boardVisible: () -> Boolean = { false },
    private val onShowBoard: () -> Unit = {},
    /** Opens a background agent's read-only transcript. See [ai.kilocode.client.session.SessionUi.openSubagent]. */
    private val onOpenSubagent: (String, String) -> Unit = { _, _ -> },
) : BorderLayoutPanel(), SessionEditorStyleTarget {

    companion object {
        private val COMPRESS_ICON: Icon = IconLoader.getIcon("/icons/compress.svg", SessionHeaderPanel::class.java)
        private val UP_ICON: Icon = IconLoader.getIcon("/icons/arrow-up.svg", SessionHeaderPanel::class.java)
        private val DOWN_ICON: Icon = IconLoader.getIcon("/icons/arrow-down-to-line.svg", SessionHeaderPanel::class.java)
        private const val TOUCH_BEGIN = 2
        private const val TOUCH_UPDATE = 3
        private const val TOUCH_END = 4
        internal const val EXPANDED_KEY = "kilo.session.header.expanded"
    }

    private val title = JBLabel().apply {
        putClientProperty(SwingTextTrimmer.KEY, SwingTextTrimmer.ELLIPSIS_AT_RIGHT)
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                toggle()
            }
        })
    }
    private val cost = JBLabel()
    private val context = JBLabel()
    private val agentStrip = BackgroundAgentStrip(
        readonly = readonly,
        onOpen = onOpenSubagent,
        onCancel = controller::cancelBackgroundAgent,
        onCancelAll = { jobs -> jobs.forEach(controller::cancelBackgroundAgent) },
        onDismiss = controller::dismissBackgroundAgents,
    )
    private val todoStrip = TodoStrip()
    private val compact = HoverIcon().apply {
        icon = COMPRESS_ICON
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("session.header.compact.description")
        accessibleContext.accessibleName = KiloBundle.message("session.header.compact")
        addActionListener { controller.compact() }
    }
    private val board = HoverIcon().apply {
        icon = SessionViewIcons.bubble
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("session.board.tooltip")
        accessibleContext.accessibleName = KiloBundle.message("session.board.tooltip")
        addActionListener { onShowBoard() }
    }
    private val expand = JBLabel().apply {
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm())
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        toolTipText = KiloBundle.message("session.header.expand")
        accessibleContext.accessibleName = KiloBundle.message("session.header.expand")
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                toggle()
            }
        })
    }
    private val timeline = TimelinePanel()
    private val viewport = JViewport().apply {
        isOpaque = false
        view = timeline
    }
    private var press: Point? = null
    private var origin = Point()
    private var rest = 0.0
    private val bar = ContextBar()
    private val tokenTitle = JBLabel(KiloBundle.message("session.header.tokens"))
    private val input = JBLabel().apply {
        icon = UP_ICON
        iconTextGap = UiStyle.Gap.xs()
    }
    private val output = JBLabel().apply {
        icon = DOWN_ICON
        iconTextGap = UiStyle.Gap.xs()
    }
    private val cacheRead = JBLabel().apply {
        icon = DOWN_ICON
        iconTextGap = UiStyle.Gap.xs()
    }
    private val cacheWrite = JBLabel().apply {
        icon = UP_ICON
        iconTextGap = UiStyle.Gap.xs()
    }
    private val top = BorderLayoutPanel()
    private val right = Stack.horizontal()
        .next(cost)
        .gap(UiStyle.Gap.xl())
        .next(context)
        .gap(UiStyle.Gap.sm())
        .next(board)
        .gap(UiStyle.Gap.sm())
        .next(compact)
    private val tokens = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.pad(), 0, UiStyle.Gap.pad())
        add(tokenTitle)
        add(Box.createHorizontalStrut(UiStyle.Gap.md()))
        add(input)
        add(Box.createHorizontalStrut(UiStyle.Gap.sm()))
        add(output)
        add(Box.createHorizontalStrut(UiStyle.Gap.sm()))
        add(cacheRead)
        add(Box.createHorizontalStrut(UiStyle.Gap.sm()))
        add(cacheWrite)
    }
    private val body = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(
            UiStyle.Gap.sm(),
            UiStyle.Gap.xl(),
            UiStyle.Gap.md(),
            UiStyle.Gap.xl(),
        )
        add(viewport)
        add(tokens)
        add(bar)
    }
    // Always visible regardless of [isExpanded] — background agents and to-dos must not require
    // expanding the metrics body to be seen (they cannot scroll away). See [Strip].
    private val strips = JPanel().apply {
        isOpaque = false
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(0, UiStyle.Gap.xl(), UiStyle.Gap.md(), UiStyle.Gap.xl())
        add(agentStrip)
        add(todoStrip)
    }
    private var style = SessionEditorStyle.current()
    private var costValue = ""

    init {
        isOpaque = true
        updateUI()

        top.add(expand, BorderLayout.WEST)
        top.add(title, BorderLayout.CENTER)
        top.add(right, BorderLayout.EAST)
        add(top, BorderLayout.NORTH)
        // SOUTH, not stacked under `top`, so the expandable stats body (CENTER) opens directly
        // below the title row and the strips stay pinned beneath it.
        add(strips, BorderLayout.SOUTH)
        timeline.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(event: MouseEvent) {
                press = event.point
                origin = viewport.viewPosition
            }

            override fun mouseReleased(event: MouseEvent) {
                press = null
            }
        })
        timeline.addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseDragged(event: MouseEvent) {
                drag(event)
            }
        })
        timeline.addMouseWheelListener { scroll(it) }
        viewport.addMouseWheelListener { scroll(it) }

        controller.model.addListener(parent) { event ->
            when (event) {
                is SessionModelEvent.HeaderUpdated -> update(event.header)
                is SessionModelEvent.BackgroundAgentsUpdated -> agentStrip.update(event.agents)

                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.ContentDelta,
                is SessionModelEvent.StateChanged,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.SessionUpdated,
                is SessionModelEvent.RevertChanged,
                is SessionModelEvent.QueueChanged,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.HistoryLoaded,
                is SessionModelEvent.Cleared,
                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.TurnRemoved -> Unit
            }
        }

        applyStyle(style)
        syncExpanded(expanded())
        update(controller.model.header)
    }

    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(separator(), 0, 0, 1, 0),
            JBUI.Borders.empty(),
        )
    }

    private fun separator() = JBColor.namedColor("EditorTabs.underTabsBorderColor", JBUI.CurrentTheme.EditorTabs.borderColor())

    fun update(header: SessionHeaderSnapshot) {
        val before = isVisible
        title.text = header.title
        title.toolTipText = header.title
        title.accessibleContext.accessibleName = header.title
        isVisible = header.visible
        if (!header.visible) {
            syncExpanded(false)
            if (before) refresh()
            return
        }

        syncExpanded(expanded())

        setCost(money(header.cost))
        set(context, contextText(header.context))
        context.toolTipText = contextTip(header.context)
        setTokens(header.tokens)
        todoStrip.update(header.todos.items)
        // Driven from here as well as from BackgroundAgentsUpdated: the model suppresses a no-change
        // event, so a session that never had a background agent would otherwise never sync the strip.
        agentStrip.update(controller.model.backgroundAgents)

        compact.isVisible = !readonly
        compact.isEnabled = !readonly && header.canCompact
        board.isVisible = boardVisible()
        val appended = timeline.setItems(header.timeline)
        sizeTimeline()
        if (viewport.isVisible != timeline.isVisible) viewport.isVisible = timeline.isVisible
        if (appended) SwingUtilities.invokeLater { endTimeline() }
        bar.setUsage(header.context)
        refresh()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        val bg = SessionUiStyle.Colors.sessionBackground()
        background = bg
        foreground = style.editorForeground
        top.background = bg
        top.isOpaque = true
        top.border = JBUI.Borders.empty(UiStyle.Gap.md(), UiStyle.Gap.sm(), UiStyle.Gap.md(), UiStyle.Gap.sm())
        right.background = bg
        tokens.background = bg
        body.background = bg
        viewport.background = bg
        title.font = style.boldFont
        title.foreground = style.editorForeground
        cost.font = style.regularFont
        cost.foreground = style.editorForeground
        cost.icon = null
        context.font = style.regularFont
        context.foreground = style.editorForeground
        agentStrip.applyStyle(style)
        todoStrip.applyStyle(style)
        tokenTitle.font = style.smallFont
        tokenTitle.foreground = style.editorForeground
        input.font = style.smallFont
        input.foreground = style.editorForeground
        output.font = style.smallFont
        output.foreground = style.editorForeground
        cacheRead.font = style.smallFont
        cacheRead.foreground = style.editorForeground
        cacheWrite.font = style.smallFont
        cacheWrite.foreground = style.editorForeground
        bar.applyStyle(style)
        refresh()
    }

    internal fun titleText(): String = title.text

    internal fun titleLabel() = title

    internal fun costText(): String = costValue

    internal fun costTip() = cost.toolTipText

    internal fun contextText(): String = context.text

    internal fun foregrounds() = listOf(title, cost, context).map { it.foreground } +
        todoStrip.labelForeground() +
        listOf(tokenTitle, input, output, cacheWrite, cacheRead).map { it.foreground }

    internal fun tokenText(): String = listOf(tokenTitle, input, output, cacheWrite, cacheRead)
        .filter { it.isVisible }
        .joinToString(" ") { it.text }

    // ------ background agents strip test accessors ------

    internal fun agentStripPanel(): BackgroundAgentStrip = agentStrip

    // ------ todo strip test accessors (delegate to TodoStrip; kept for existing tests) ------

    internal fun todoText(): String = todoStrip.labelText()

    internal fun todoVisible(): Boolean = todoStrip.isVisible

    internal fun todoListVisible(): Boolean = todoStrip.bodyAttached()

    internal fun todoRowPanel(): JComponent = todoStrip.rowPanel()

    internal fun todoLabel(): JComponent = todoStrip.labelComponent()

    internal fun todoListPanel(): TodoStrip = todoStrip

    internal fun tokenTip(): String = tokens.toolTipText

    internal fun inputTokenText(): String = input.text

    internal fun outputTokenText(): String = output.text

    internal fun cacheReadText(): String = cacheRead.text

    internal fun cacheWriteText(): String = cacheWrite.text

    internal fun compactButton() = compact

    internal fun boardButton() = board

    internal fun rightPanel() = right

    internal fun expandButton() = expand

    internal fun isExpanded() = body.parent === this

    internal fun bodyPanel() = body

    internal fun bodyComponents() = body.components.toList()

    internal fun timelineViewport(): JViewport = viewport

    internal fun tokenPanel() = tokens

    internal fun timelinePanel(): Component = timeline

    internal fun timelineToolTip() = timeline.toolTipText

    internal fun timelineHover() = timeline.hovered()

    internal fun contextBar(): Component = bar

    internal fun contextBarVisible() = bar.isVisible

    internal fun contextBarUsed() = bar.used()

    internal fun contextBarReserved() = bar.reserved()

    internal fun contextBarAvailable() = bar.available()

    internal fun contextBarLimit() = bar.limit()

    internal fun contextBarForegrounds() = bar.foregrounds()

    internal fun contextBarTip() = bar.toolTipText

    internal fun contextBarTrackColor() = bar.trackColor()

    internal fun contextBarUsedColor() = bar.usedColor()

    internal fun contextBarReservedColor() = bar.reservedColor()

    internal fun timelineCount() = timeline.count()

    internal fun timelineParts() = timeline.parts()

    internal fun timelineActive(index: Int) = timeline.active(index)

    internal fun timelinePreferredSize() = timeline.preferredSize

    internal fun timelineBarHeight(index: Int) = timeline.barHeight(index)

    internal fun timelineBarWidth() = timeline.barWidth()

    internal fun timelineViewportPreferredSize() = viewport.preferredSize

    internal fun expandTip() = expand.toolTipText

    private fun setTokens(value: TokensDto?) {
        val tk = value
        val sent = tk?.input ?: 0L
        val received = (tk?.output ?: 0L) + (tk?.reasoning ?: 0L)
        val write = tk?.cacheWrite ?: 0L
        val read = tk?.cacheRead ?: 0L
        val total = listOf(sent, received, write, read).fold(0L) { sum, value ->
            if (value <= 0) return@fold sum
            if (Long.MAX_VALUE - sum < value) return@fold Long.MAX_VALUE
            sum + value
        }

        tokenTitle.text = KiloBundle.message("session.header.tokens")
        tokens.toolTipText = KiloBundle.message("session.header.tokens.description")
        tokenTitle.isVisible = total > 0
        set(input, if (sent > 0) num(sent) else null)
        set(output, if (received > 0) num(received) else null)
        set(cacheWrite, if (write > 0) KiloBundle.message("session.header.cache.write", num(write)) else null)
        set(cacheRead, if (read > 0) KiloBundle.message("session.header.cache.read", num(read)) else null)
        tokens.isVisible = total > 0
    }

    private fun setCost(value: String?) {
        costValue = value.orEmpty()
        cost.text = costValue
        cost.icon = null
        val tip = costValue.takeIf { it.isNotBlank() }?.let { KiloBundle.message("session.header.cost.tooltip", it) }
        cost.toolTipText = tip
        cost.accessibleContext.accessibleName = tip
        cost.isVisible = costValue.isNotBlank()
    }

    private fun toggle() {
        val next = !isExpanded()
        syncExpanded(next)
        PropertiesComponent.getInstance().setValue(EXPANDED_KEY, next.toString())
        refresh()
    }

    private fun syncExpanded(expanded: Boolean) {
        if (expanded) expand() else collapse()
    }

    private fun expand(): Boolean {
        if (isExpanded()) return false
        add(body, BorderLayout.CENTER)
        setExpand(true)
        return true
    }

    private fun collapse(): Boolean {
        val attached = body.parent === this
        if (!attached) {
            setExpand(false)
            return false
        }
        remove(body)
        setExpand(false)
        return attached
    }

    private fun setExpand(expanded: Boolean) {
        val key = if (expanded) "session.header.collapse" else "session.header.expand"
        expand.text = ""
        expand.icon = if (expanded) AllIcons.General.ChevronDown else AllIcons.General.ChevronRight
        expand.toolTipText = KiloBundle.message(key)
        expand.accessibleContext.accessibleName = KiloBundle.message(key)
    }

    private fun expanded() = PropertiesComponent.getInstance().getBoolean(EXPANDED_KEY, false)

    private fun sizeTimeline() {
        val size = timeline.preferredSize
        viewport.preferredSize = Dimension(0, size.height)
        viewport.minimumSize = viewport.preferredSize
        viewport.maximumSize = Dimension(Int.MAX_VALUE, viewport.preferredSize.height)
    }

    private fun drag(event: MouseEvent) {
        val start = press ?: return
        val max = limit()
        val x = (origin.x - (event.x - start.x)).coerceIn(0, max)
        move(x)
    }

    private fun endTimeline() {
        move(limit())
    }

    private fun scroll(event: MouseWheelEvent) {
        if (event.scrollType == TOUCH_BEGIN || event.scrollType == TOUCH_END) {
            rest = 0.0
            event.consume()
            return
        }
        val delta = delta(event)
        if (delta == 0.0) return
        rest += delta
        val x = rest.toInt()
        if (x == 0) return
        if (!move(viewport.viewPosition.x + x)) {
            rest = 0.0
            return
        }
        rest -= x
        event.consume()
    }

    private fun delta(event: MouseWheelEvent): Double {
        if (!event.preciseWheelRotation.isFinite()) return 0.0
        if (event.scrollType == TOUCH_UPDATE) return event.preciseWheelRotation * event.scrollAmount
        if (event.scrollType == MouseWheelEvent.WHEEL_BLOCK_SCROLL) return event.preciseWheelRotation * viewport.extentSize.width
        return event.preciseWheelRotation * event.scrollAmount * timeline.barWidth()
    }

    private fun move(x: Int): Boolean {
        val next = x.coerceIn(0, limit())
        if (viewport.viewPosition.x == next) return false
        viewport.setViewPosition(Point(next, 0))
        return true
    }

    private fun limit(): Int {
        val wide = timeline.preferredSize.width.coerceAtLeast(timeline.width)
        return (wide - viewport.extentSize.width).coerceAtLeast(0)
    }

    private fun refresh() {
        revalidate()
        repaint()
    }
}
