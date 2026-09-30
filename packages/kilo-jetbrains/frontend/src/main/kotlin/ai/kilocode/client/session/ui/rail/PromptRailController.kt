package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.scroll.SessionScroll
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.popup.SidePopupController
import ai.kilocode.client.ui.popup.SidePopupContent
import ai.kilocode.client.ui.popup.SidePopupRequest
import ai.kilocode.client.ui.popup.SidePopupSpot
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.AdjustmentListener
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import javax.swing.JPanel
import javax.swing.SwingUtilities
import javax.swing.event.ChangeListener

/**
 * Owns the prompt navigator rail: its bounds on the session overlay, its data (from [SessionModel]
 * events), the active tick (from scroll position), and the balloon that lists every prompt.
 *
 * Placement mirrors the jump-to-bottom button's readable-lane math (see [SessionScroll]): when the
 * viewport has room right of the lane, the rail sits at the standard large inset from the panel edge;
 * otherwise it covers the scrollbar column so it stays reachable in a narrow sidebar.
 */
internal class PromptRailController(
    private val root: SessionRootPanel,
    private val model: SessionModel,
    private val messages: SessionMessageListPanel,
    private val scroll: SessionScroll,
    parent: Disposable,
    timers: UiTimerSource = UiTimers,
) : Disposable {
    val rail = PromptRail()
    private val popup = SidePopupController(timers, SessionUiStyle.PromptRail.OPEN_MS)
    private var style = SessionEditorStyle.current()
    private var dirty = false
    private var dead = false

    /** The live balloon body, so a move between ticks can re-select in place instead of reopening it. */
    private var body: PromptRailPopup? = null
    private val adjustment = AdjustmentListener { recomputeActive() }
    private val change = ChangeListener { recomputeActive() }
    private val geometry = object : ComponentAdapter() {
        override fun componentResized(e: ComponentEvent) = scheduleRebuild()
        override fun componentShown(e: ComponentEvent) = scheduleRebuild()
        override fun componentHidden(e: ComponentEvent) = scheduleRebuild()
    }

    init {
        rail.wheelTarget = scroll.component
        rail.onSelect = { entry -> select(entry) }
        rail.onHover = { entry -> hover(entry) }
        rail.onWheel = {
            popup.hideAll()
            rail.setOpen(-1)
        }
        root.addOverlay(rail) { pane, _ -> bounds(pane) }

        scroll.bar.addAdjustmentListener(adjustment)
        scroll.component.viewport.addChangeListener(change)
        scroll.component.viewport.addComponentListener(geometry)
        scroll.bar.addComponentListener(geometry)

        model.addListener(parent) { event ->
            when (event) {
                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.TurnRemoved,
                is SessionModelEvent.HistoryLoaded,
                is SessionModelEvent.Cleared,
                is SessionModelEvent.RevertChanged,
                is SessionModelEvent.QueueChanged,
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageRemoved,
                -> scheduleRebuild()

                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.ContentDelta,
                -> scheduleRebuild()

                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.StateChanged,
                is SessionModelEvent.SessionUpdated,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.BackgroundAgentsUpdated,
                is SessionModelEvent.HeaderUpdated,
                is SessionModelEvent.Compacted,
                -> Unit
            }
        }

        Disposer.register(parent, this)
        rebuild()
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        root.overlay.revalidate()
        root.overlay.repaint()
    }

    @RequiresEdt
    fun refresh() {
        rebuild()
    }

    @RequiresEdt
    fun hideAll() {
        // Disposing the body clears `body` and the open tick through the hook registered in `request`.
        popup.hideAll()
        rail.setOpen(-1)
    }

    @RequiresEdt
    override fun dispose() {
        dead = true
        dirty = false
        scroll.bar.removeAdjustmentListener(adjustment)
        scroll.component.viewport.removeChangeListener(change)
        scroll.component.viewport.removeComponentListener(geometry)
        scroll.bar.removeComponentListener(geometry)
        hideAll()
    }

    @RequiresEdt
    private fun scheduleRebuild() {
        if (dead || dirty) return
        dirty = true
        ApplicationManager.getApplication().invokeLater {
            if (dead || !dirty) return@invokeLater
            dirty = false
            rebuild()
        }
    }

    @RequiresEdt
    private fun rebuild() {
        val items = PromptRailItems.items(model)
        val capacity = PromptRailItems.capacity(
            scroll.component.viewport.height,
            JBUI.scale(SessionUiStyle.PromptRail.STEP_MIN),
            JBUI.scale(SessionUiStyle.PromptRail.RAIL_INSET) / 2,
        )
        val entries = PromptRailItems.entries(items, capacity)
        rail.update(items, entries, activeIndex(items))
        rail.setAvailable(scroll.view === messages)
        relayout()
    }

    @RequiresEdt
    private fun recomputeActive() {
        rail.setAvailable(scroll.view === messages)
        if (rail.items().isEmpty()) return
        rail.update(rail.items(), rail.entries(), activeIndex(rail.items()))
    }

    private fun activeIndex(items: List<PromptRailItem>): Int? {
        if (items.isEmpty()) return null
        val tops = items.map { top(it.id) }
        val vp = scroll.component.viewport
        val bar = scroll.bar
        val scrollable = bar.maximum > bar.visibleAmount
        val atTop = vp.viewPosition.y <= 0
        return PromptRailItems.active(tops, vp.viewPosition.y, scrollable, atTop)
    }

    private fun top(id: String): Int {
        val turn = messages.findTurn(id) ?: return 0
        return SwingUtilities.convertPoint(turn, Point(0, 0), messages).y
    }

    @RequiresEdt
    private fun relayout() {
        root.overlay.revalidate()
        root.overlay.repaint()
    }

    private fun select(entry: PromptRailEntry) {
        when (entry) {
            is PromptRailEntry.Prompt -> jump(rail.items().getOrNull(entry.index)?.id)
            // The overflow tick stands in for prompts with no tick of their own, so its only action is
            // revealing them in the list — without waiting out the hover dwell.
            is PromptRailEntry.Overflow -> {
                rail.setOpen(rail.entries().indexOf(entry))
                if (popup.showing()) {
                    body?.select(item(entry))
                    return
                }
                popup.showNow(rail, this) { request() }
            }
        }
    }

    private fun jump(id: String?) {
        if (id == null) return
        scroll.scrollMessageTop(id)
    }

    /**
     * The balloon is keyed on the rail rather than on the hovered tick, so travelling down the ticks
     * neither restarts the dwell nor rebuilds it somewhere else — only the highlighted row follows the
     * pointer. The open tick is left alone on exit so the rail stays lit while the pointer is inside the
     * balloon; it is cleared when the balloon actually goes away.
     */
    private fun hover(entry: PromptRailEntry?) {
        if (entry == null) {
            popup.notifyExit(rail)
            return
        }
        rail.setOpen(rail.entries().indexOf(entry))
        popup.show(rail, this) { request() }
        body?.select(item(entry))
    }

    /** Item the list should highlight for [entry]; an overflow tick points at the first prompt it hides. */
    private fun item(entry: PromptRailEntry): Int = when (entry) {
        is PromptRailEntry.Prompt -> entry.index
        is PromptRailEntry.Overflow -> entry.hidden.first
    }

    private fun request(): SidePopupRequest = SidePopupRequest(
        build = {
            PromptRailPopup(
                items = rail.items(),
                hovered = rail.entries().getOrNull(rail.hover())?.let(::item) ?: 0,
                onSelect = { item -> jump(item.id) },
                onFirst = { rail.items().firstOrNull()?.let { jump(it.id) } },
                onLatest = { rail.items().lastOrNull()?.let { jump(it.id) } },
            ).also { built ->
                body = built
                Disposer.register(built.disposable) {
                    if (body === built) body = null
                    rail.setOpen(-1)
                }
            }
        },
        place = { built -> place(built) },
    )

    /**
     * Puts the balloon entirely left of the ticks, so the body opens into the transcript instead of
     * covering the rail it was opened from. The body is capped to the room between the rail and the
     * window edge, and its height to the visible session.
     *
     * The point handed back is the balloon's intended center, not an edge: with the callout off the
     * platform ignores the position and the pointer distance and centers the box on the target (see
     * [PromptRailPlacement]). `SidePopupGeometry` is deliberately not used here — its `aim` result drives
     * `cornerToPointerDistance`, which only applies to balloons that draw a pointer.
     */
    private fun place(built: SidePopupContent): SidePopupSpot? {
        val pane = SwingUtilities.getRootPane(rail)?.layeredPane ?: return null
        if (!rail.isShowing) return null
        val area = SwingUtilities.convertRectangle(root, root.visibleRect, pane)
        if (area.isEmpty) return null
        val rect = SwingUtilities.convertRectangle(rail.parent, rail.bounds, pane)
        val gap = UiStyle.Gap.pad()
        val insets = UiStyle.Balloon.insets()
        // The shadow is reserved on every side, so it counts twice on each axis. There is no callout
        // here, so unlike the header popups the pointer adds nothing.
        val shadow = UiStyle.Balloon.shadow()
        val chromeWidth = insets.left + insets.right + shadow * 2
        val chromeHeight = insets.top + insets.bottom + shadow * 2
        // Room is measured to the window edge rather than the chat panel: the rail hugs the right side of
        // a narrow sidebar, where the panel alone would leave almost nothing to open into.
        val maxWidth = PromptRailPlacement.maxWidth(
            railX = rect.x,
            gap = gap,
            chrome = chromeWidth,
            cap = JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH),
        )
        val maxHeight = PromptRailPlacement.maxHeight(
            height = area.height,
            gap = gap,
            chrome = chromeHeight,
            cap = JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT),
        )
        if (maxWidth <= 0 || maxHeight <= 0) return null
        built.fitWithin(maxWidth, maxHeight)
        val body = built.component.preferredSize
        val content = Dimension(
            body.width + insets.left + insets.right,
            body.height + insets.top + insets.bottom,
        )
        val center = PromptRailPlacement.center(
            railX = rect.x,
            area = area,
            gap = gap,
            content = content,
            // Centred on the rail, not the hovered tick, so the balloon does not drift while the pointer
            // moves between ticks.
            anchorY = rect.y + rect.height / 2,
        )
        return SidePopupSpot(
            pane = pane,
            point = center,
            // Ignored while the callout is off, but kept correct so enabling it would still open left.
            position = Balloon.Position.atLeft,
            distance = 0,
            callout = false,
        )
    }

    /**
     * Rail bounds, in overlay coordinates: standard inset right of the readable lane when there is
     * room, or centered over the scrollbar column when the transcript is squeezed horizontally.
     */
    private fun bounds(pane: JPanel): Rectangle {
        val vp = scroll.component.viewport
        if (vp.parent == null || vp.width <= 0 || vp.height <= 0) return Rectangle()
        val vpBounds = SwingUtilities.convertRectangle(vp, Rectangle(vp.size), pane)
        val lane = minOf(vp.width, SessionUiStyle.SessionLayout.readableWidth(messages, style.transcriptFont))
        val laneRight = vp.x + (vp.width + lane) / 2
        val railW = JBUI.scale(SessionUiStyle.PromptRail.TICK_HOVER)
        val pad = UiStyle.Gap.pad()
        val vpRightInPane = vpBounds.x + vpBounds.width
        val bar = scroll.bar
        val barBounds = if (bar.isVisible && bar.width > 0) {
            SwingUtilities.convertRectangle(bar, Rectangle(bar.size), pane)
        } else {
            null
        }
        val contentRight = barBounds?.x ?: vpRightInPane
        val laneRightInPane = SwingUtilities.convertPoint(vp, Point(laneRight - vp.x, 0), pane).x
        val wide = contentRight - laneRightInPane >= railW + 2 * pad
        val top = vpBounds.y
        val height = vpBounds.height
        if (wide) {
            rail.centered = false
            val right = contentRight - pad
            return Rectangle(right - railW, top, railW, height)
        }
        rail.centered = true
        if (barBounds != null) {
            val width = barBounds.width.coerceAtMost(railW).coerceAtLeast(JBUI.scale(2))
            val x = barBounds.x + (barBounds.width - width) / 2
            return Rectangle(x, top, width, height)
        }
        val padding = JBUI.scale(SessionUiStyle.SessionLayout.TRANSCRIPT_SCROLLBAR_PADDING)
        val width = padding.coerceAtMost(railW).coerceAtLeast(JBUI.scale(2))
        return Rectangle(vpRightInPane - padding + (padding - width) / 2, top, width, height)
    }
}
