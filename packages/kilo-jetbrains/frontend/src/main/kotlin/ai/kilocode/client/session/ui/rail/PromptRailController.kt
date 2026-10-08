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

    /**
     * Item the navigator should highlight, captured when the tick is hovered.
     *
     * The body is built when the dwell elapses, not when the hover happens, so reading the rail's live
     * hover state at build time raced the pointer: by then it could sit on another tick, or have left the
     * band entirely and report -1. Recording the intent up front makes the opened balloon show the tick
     * that actually asked for it.
     */
    private var pending = -1

    /** Per-turn preview cache, so a streamed delta only re-previews the turn it changed. */
    private val cache = PromptRailItems.Cache()
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
        val items = PromptRailItems.items(model, cache)
        val capacity = PromptRailItems.capacity(
            scroll.component.viewport.height,
            JBUI.scale(SessionUiStyle.PromptRail.STEP_MIN),
            JBUI.scale(SessionUiStyle.PromptRail.RAIL_INSET) / 2,
        )
        val entries = PromptRailItems.entries(items, capacity)
        val stale = body != null && rail.items() != items
        rail.update(items, entries, activeIndex(items))
        rail.setAvailable(scroll.view === messages)
        // The open card captured the list it was built from, so once the transcript moves on it is
        // showing rows that no longer match the rail. Close it rather than leave it misleading; the next
        // hover rebuilds it from the current prompts.
        if (stale) hideAll()
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
                pending = item(entry)
                if (popup.showing()) {
                    body?.select(pending)
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
     * Navigates to the prompt at [index]: scrolls the transcript to it, highlights its row, and moves
     * the rail's tick emphasis to it. [scroll] additionally brings the row into view in the list.
     *
     * The first/latest buttons and a row click all route through here. Scrolling the transcript alone
     * would leave the open card still pointing at whichever row the pointer last hovered, so the
     * navigator would disagree with what the transcript is showing.
     */
    @RequiresEdt
    private fun go(index: Int, scroll: Boolean = true) {
        val item = rail.items().getOrNull(index) ?: return
        pending = index
        rail.setOpen(tick(index))
        body?.select(index, scroll)
        jump(item.id)
    }

    /** Tick showing the prompt at [item], or -1 when that prompt sits behind the overflow tick. */
    private fun tick(item: Int): Int =
        rail.entries().indexOfFirst { it is PromptRailEntry.Prompt && it.index == item }

    /**
     * The balloon is keyed on the rail rather than on the hovered tick, so travelling down the ticks
     * neither restarts the dwell nor rebuilds it somewhere else — only the highlighted row follows the
     * pointer. The open tick is left alone on exit so the rail stays lit while the pointer is inside the
     * balloon; it is cleared when the balloon actually goes away.
     */
    @RequiresEdt
    private fun hover(entry: PromptRailEntry?) {
        if (entry == null) {
            popup.notifyExit(rail)
            // The reset that clears the open tick is registered on the balloon body, so it only runs
            // if the dwell actually produced one. Leaving the band before that has to drop the hover
            // emphasis here, or the tick stays painted at hover size until the next interaction.
            if (!popup.showing()) rail.setOpen(-1)
            return
        }
        rail.setOpen(rail.entries().indexOf(entry))
        pending = item(entry)
        popup.show(rail, this) { request() }
        body?.select(pending)
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
                hovered = pending,
                // A clicked row is already under the pointer, so it is navigated to without moving the
                // list; only the buttons and tick hovers, which the user cannot aim, scroll it.
                //
                // A double click (or Enter) arrives with the list's focus flag set. That reads as a
                // committed pick rather than browsing, so the card closes and leaves the transcript on
                // the chosen prompt. A single click keeps it open for scanning further rows.
                onSelect = { item, commit ->
                    go(rail.items().indexOfFirst { it.id == item.id }, scroll = false)
                    if (commit) hideAll()
                },
                onFirst = { go(0) },
                onLatest = { go(rail.items().lastIndex) },
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
        val margin = UiStyle.Gap.pad()
        val insets = UiStyle.Balloon.insets()
        // No callout and no shadow on this balloon, so the only chrome is the border inset. The shadow
        // is switched off because it is reserved outside the border box and is hit-testable: against a
        // flush card it would cover the ticks with an invisible margin and swallow their clicks.
        val chromeWidth = insets.left + insets.right
        val chromeHeight = insets.top + insets.bottom
        // Room is measured to the window edge rather than the chat panel: the rail hugs the right side of
        // a narrow sidebar, where the panel alone would leave almost nothing to open into.
        val maxWidth = PromptRailPlacement.maxWidth(
            railX = rect.x,
            inset = FLUSH,
            margin = margin,
            chrome = chromeWidth,
            cap = JBUI.scale((SessionUiStyle.View.Popup.MAX_WIDTH * SessionUiStyle.PromptRail.WIDTH_SCALE).toInt()),
        )
        val maxHeight = PromptRailPlacement.maxHeight(
            height = area.height,
            margin = margin,
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
            inset = FLUSH,
            margin = margin,
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
            shadow = false,
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
            // Its own gutter: the bar is clear of the rail, so presses stay the rail's own.
            rail.barTarget = null
            val right = contentRight - pad
            return Rectangle(right - railW, top, railW, height)
        }
        rail.centered = true
        // Drawn over the bar, so a press that misses a tick has to reach it.
        rail.barTarget = scroll.bar.takeIf { barBounds != null }
        if (barBounds != null) {
            val width = barBounds.width.coerceAtMost(railW).coerceAtLeast(JBUI.scale(2))
            val x = barBounds.x + (barBounds.width - width) / 2
            return Rectangle(x, top, width, height)
        }
        val padding = JBUI.scale(SessionUiStyle.SessionLayout.TRANSCRIPT_SCROLLBAR_PADDING)
        val width = padding.coerceAtMost(railW).coerceAtLeast(JBUI.scale(2))
        return Rectangle(vpRightInPane - padding + (padding - width) / 2, top, width, height)
    }

    private companion object {
        /**
         * Horizontal distance kept between the card and the rail: none. Any gap is dead space where the
         * pointer is over neither surface, which starts the hide timer mid-traverse.
         */
        const val FLUSH = 0
    }
}
