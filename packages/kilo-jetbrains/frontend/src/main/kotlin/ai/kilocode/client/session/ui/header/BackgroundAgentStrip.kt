package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.AgentAvatar
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.session.background.BackgroundAgent
import ai.kilocode.client.session.background.BackgroundAgentStatus
import ai.kilocode.client.session.ui.SessionSurface
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.SessionViewIcons
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Rectangle
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.Scrollable
import javax.swing.SwingUtilities

/**
 * Background subagent status strip: a collapsible one-line summary of running/finished background
 * agents, matching [TodoStrip]'s chrome (see [Strip]). Reachable actions:
 *
 * - Clicking a row opens that agent's read-only transcript via [onOpen].
 * - "Stop" / "Stop all" cancel one or every running agent via [onCancel] / [onCancelAll].
 * - "Dismiss" / "Clear finished" hide finished rows locally via [onDismiss] — this never deletes
 *   the child session or the backend job record.
 * - "Open all" opens every visible agent's transcript.
 *
 * All rows are pure UI over [BackgroundAgent] — no RPC, no services; the owning [SessionHeaderPanel]
 * feeds [update] from [ai.kilocode.client.session.model.SessionModel.backgroundAgents].
 */
private const val MAX_VISIBLE_ROWS = 5

class BackgroundAgentStrip(
    private val readonly: Boolean,
    private val onOpen: (String, String) -> Unit,
    private val onCancel: (String) -> Unit,
    private val onCancelAll: (List<String>) -> Unit,
    private val onDismiss: (Set<String>) -> Unit,
    /** Sibling color slot for a row's generated avatar. See [AgentAvatar]. */
    private val avatarColor: (String) -> Int? = { null },
) : Strip() {

    override val vertical = true

    private var agents: List<BackgroundAgent> = emptyList()
    private var activeCount = 0
    private val rows = LinkedHashMap<String, Row>()
    private val body = Body()

    private val stopAll = HoverIcon().apply {
        icon = AllIcons.Actions.Suspend
        isVisible = false
        addActionListener { onCancelAll(agents.filter { it.status == BackgroundAgentStatus.RUNNING }.map { it.job }) }
    }
    private val clearFinished = HoverIcon().apply {
        icon = AllIcons.Actions.Close
        isVisible = false
        toolTipText = KiloBundle.message("session.header.agents.clearFinished")
        accessibleContext.accessibleName = toolTipText
        addActionListener {
            onDismiss(agents.filterNot { it.status == BackgroundAgentStatus.RUNNING }.map { it.job }.toSet())
        }
    }
    private val openAll = HoverIcon().apply {
        icon = SessionViewIcons.openDiff
        isVisible = false
        toolTipText = KiloBundle.message("session.header.agents.openAll")
        accessibleContext.accessibleName = toolTipText
        addActionListener { agents.forEach { onOpen(it.session, title(it)) } }
    }

    init {
        summary.toolTipText = KiloBundle.message("session.header.agents.toggle")
        summary.accessibleContext.accessibleName = KiloBundle.message("session.header.agents.toggle")
        actions.next(stopAll).next(clearFinished).next(openAll)
    }

    override fun createBody(): JComponent = body

    @RequiresEdt
    fun update(agents: List<BackgroundAgent>) {
        // SessionHeaderPanel re-syncs this strip on every HeaderUpdated, which streams as tokens and
        // cost arrive, so bail out unless the agents actually changed — otherwise the retained strip
        // would revalidate and repaint on every event in the streaming hot path.
        if (agents == this.agents) return
        this.agents = agents
        val running = agents.count { it.status == BackgroundAgentStatus.RUNNING }
        set(label, caption(agents))
        val aggregateIcon = statusIcon(state(agents))
        glyph.icon = aggregateIcon
        glyph.isVisible = agents.isNotEmpty() && aggregateIcon != null
        stopAll.text = KiloBundle.message("session.header.agents.stopAll", running)
        stopAll.isVisible = !readonly && running > 0
        clearFinished.isVisible = !readonly && agents.any { it.status != BackgroundAgentStatus.RUNNING }
        openAll.isVisible = agents.isNotEmpty()
        body.sync(agents)
        syncVisible(agents.isNotEmpty())
        // Auto-collapse once, on the transition into "nothing active" — not on every subsequent
        // update while it stays at zero, or a manual re-expand to dismiss a finished row would be
        // immediately undone by the next poll tick.
        val active = agents.count { it.status == BackgroundAgentStatus.RUNNING || it.waiting }
        if (active == 0 && activeCount > 0 && expanded()) collapse()
        activeCount = active
        refresh()
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        super.applyStyle(style)
        body.applyStyle(style)
    }

    private fun title(agent: BackgroundAgent): String =
        agent.title?.takeIf { it.isNotBlank() } ?: KiloBundle.message("session.header.agents.untitled")

    private fun caption(agents: List<BackgroundAgent>): String {
        val running = agents.count { it.status == BackgroundAgentStatus.RUNNING }
        val total = agents.size
        return when {
            agents.any { it.waiting } -> KiloBundle.message("session.header.agents.waiting")
            total == 1 -> KiloBundle.message("session.header.agents.running.one")
            running == 0 || running == total -> KiloBundle.message("session.header.agents.running.many", total)
            else -> KiloBundle.message("session.header.agents.summary", running, total)
        }
    }

    private fun state(agents: List<BackgroundAgent>): BackgroundAgentStatus = when {
        agents.any { it.status == BackgroundAgentStatus.RUNNING || it.waiting } -> BackgroundAgentStatus.RUNNING
        agents.any { it.status == BackgroundAgentStatus.ERROR } -> BackgroundAgentStatus.ERROR
        agents.any { it.status == BackgroundAgentStatus.CANCELLED } -> BackgroundAgentStatus.CANCELLED
        else -> BackgroundAgentStatus.COMPLETED
    }

    // Raised content surface painted with the editor background, matching TodoListPanel's block arc.
    private inner class Body : Stack(StackAxis.VERTICAL, JBUI.scale(SessionUiStyle.View.Layout.GAP)), Scrollable {
        // Ordered job IDs from the most recent `sync(agents)`, used to find the first five rows for
        // the viewport height cap below. `Stack` keeps its own entry order (see the reorder comment
        // in `sync`), which can briefly disagree with `rows.keys` while a reorder is in flight.
        private var order = emptyList<String>()

        init {
            border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad())
        }

        override fun paintComponent(g: Graphics) {
            SessionSurface.fill(g, width, height)
            super.paintComponent(g)
        }

        override fun paintChildren(g: Graphics) {
            SessionSurface.clipped(g, width, height) { super.paintChildren(it) }
        }

        fun sync(agents: List<BackgroundAgent>) {
            order = agents.map { it.job }
            val ids = agents.map { it.job }.toSet()
            for (stale in rows.keys.filter { it !in ids }) {
                val row = rows.remove(stale) ?: continue
                remove(row.panel)
            }
            for (agent in agents) {
                val row = rows[agent.job]
                if (row == null) {
                    val created = Row(::title, onOpen, ::onRowAction, readonly, avatarColor).also { it.applyStyle(style) }
                    created.update(agent)
                    rows[agent.job] = created
                    next(created.panel)
                    continue
                }
                row.update(agent)
            }
            // Rows that already exist are updated in place, so without this an agent that finishes
            // would keep its old slot above still-active ones instead of following
            // BackgroundAgents.order. Stack lays out from its own entries list rather than the AWT
            // component array, and re-adding a child moves it to the end of that list, so restate the
            // order by re-adding every row. setComponentZOrder would not work here: it reorders the
            // component array that Stack's layout does not read.
            val order = agents.map { it.job }
            if (order != rows.keys.toList()) {
                for (job in order) next(rows[job]?.panel ?: continue)
                val sorted = order.mapNotNull { job -> rows[job]?.let { job to it } }
                rows.clear()
                rows.putAll(sorted)
            }
            revalidate()
            repaint()
        }

        fun applyStyle(style: SessionEditorStyle) {
            for (row in rows.values) row.applyStyle(style)
        }

        override fun getScrollableTracksViewportWidth() = true

        override fun getScrollableTracksViewportHeight() = false

        // Caps the expanded strip to five visible rows before it scrolls, per row's actual preferred
        // height rather than a hardcoded pixel constant — row height varies with font size, IDE zoom,
        // and Look and Feel metrics.
        override fun getPreferredScrollableViewportSize(): Dimension {
            val visible = order.asSequence().mapNotNull(rows::get).take(MAX_VISIBLE_ROWS).toList()
            val ins = insets
            val height = ins.top + ins.bottom +
                visible.sumOf { it.panel.preferredSize.height } +
                space * (visible.size - 1).coerceAtLeast(0)
            return Dimension(preferredSize.width, height)
        }

        override fun getScrollableUnitIncrement(visibleRect: Rectangle, orientation: Int, direction: Int) =
            JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT)

        override fun getScrollableBlockIncrement(visibleRect: Rectangle, orientation: Int, direction: Int) =
            visibleRect.height
    }

    private fun onRowAction(agent: BackgroundAgent) {
        if (agent.status == BackgroundAgentStatus.RUNNING) onCancel(agent.job) else onDismiss(setOf(agent.job))
    }

    // ------ test accessors ------

    internal fun stopAllButton(): HoverIcon = stopAll
    internal fun clearFinishedButton(): HoverIcon = clearFinished
    internal fun openAllButton(): HoverIcon = openAll
    internal fun rowCount(): Int = rows.size
    internal fun agentRowPanel(job: String): JComponent? = rows[job]?.panel
    internal fun rowTitleText(job: String): String? = rows[job]?.title?.text
    internal fun rowStatusText(job: String): String? = rows[job]?.status?.text
    internal fun rowStatusIcon(job: String): Icon? = rows[job]?.statusGlyph?.icon
    internal fun rowStatusGlyphVisible(job: String): Boolean = rows[job]?.statusGlyph?.isVisible == true
    internal fun rowAvatarIcon(job: String): Icon? = rows[job]?.avatar?.icon
    internal fun rowAvatarComponent(job: String): JComponent? = rows[job]?.avatar
    internal fun rowNeedsInputVisible(job: String): Boolean = rows[job]?.needsInput?.isVisible == true
    internal fun rowActionVisible(job: String): Boolean = rows[job]?.action?.isVisible == true
    internal fun rowActionButton(job: String): HoverIcon? = rows[job]?.action

    private class Row(
        private val titleFor: (BackgroundAgent) -> String,
        private val onOpen: (String, String) -> Unit,
        private val onAction: (BackgroundAgent) -> Unit,
        private val readonly: Boolean,
        private val avatarColor: (String) -> Int? = { null },
    ) {
        private var agent = BackgroundAgent("", "", null, BackgroundAgentStatus.RUNNING)
        // Recreated only when the child session id or its resolved sibling color changes; a status
        // change just swaps between these two retained icons — see [AgentAvatar].
        private var avatarId = ""
        private var avatarColorSlot: Int? = null
        private var avatarStatic = AgentAvatar.static(avatarId, avatarColorSlot)
        private var avatarRunning = AgentAvatar.running(avatarId, avatarColorSlot)

        /** Generated per-subagent identity, replacing the old shared running/terminal glyph here. */
        val avatar = JBLabel()

        /**
         * Terminal-state glyph next to the status text: success/error icon, or a blank glyph sized to
         * match for cancelled. Hidden while running — the avatar's own pulse already shows activity,
         * so a second spinner would be redundant.
         */
        val statusGlyph = JBLabel()
        val title = JBLabel()
        val status = JBLabel()
        val needsInput = JBLabel(KiloBundle.message("session.header.agents.needsInput")).apply {
            foreground = UiStyle.Colors.warningLabelForeground()
            isVisible = false
        }
        val action = HoverIcon().apply { isFocusable = false }
        private val actionSlot = action.align(HAlign.RIGHT, VAlign.CENTER)
        val panel = HoverPanel().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.xs(), UiStyle.Gap.sm())
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            // Icon + title + status are vertically centered and left-aligned; the action stays
            // vertically centered on the trailing edge. Both use bounded-preferred `Align` wrappers
            // rather than `BorderLayout`'s own stretch-to-height behavior, so a taller sibling never
            // stretches the avatar or the action button out of their natural size.
            add(avatar.align(HAlign.LEFT, VAlign.CENTER), BorderLayout.WEST)
            add(
                Stack.horizontal(UiStyle.Gap.sm()).apply {
                    next(title)
                    next(statusGlyph)
                    next(status)
                    next(needsInput)
                }.align(HAlign.LEFT, VAlign.CENTER),
                BorderLayout.CENTER,
            )
            add(actionSlot, BorderLayout.EAST)
        }

        /** Opens this agent's transcript in its own read-only editor tab. */
        private val click = object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) = onOpen(agent.session, titleFor(agent))
        }

        // Hover is tracked across the whole row subtree: Swing delivers mouseExited only to the
        // deepest component, so a listener on the row alone would drop the fill as soon as the
        // pointer reached the trailing action button. The children are built here and never
        // replaced, so a one-time walk is enough — no ContainerListener needed.
        private val pointer = object : MouseAdapter() {
            override fun mouseEntered(event: MouseEvent) = hover(true)

            override fun mouseExited(event: MouseEvent) {
                if (inside(event)) return
                hover(false)
            }
        }

        init {
            action.addActionListener { onAction(agent) }
            watch(panel)
        }

        /**
         * Binds hover to the whole subtree, and the open-click to every element that does not already
         * own a mouse listener. Swing delivers a click only to the innermost listener, so without the
         * per-child binding the hover listener would swallow clicks on the icon and labels and only
         * the row's padding would open the tab. The check runs before [pointer] is attached, so the
         * trailing action button keeps its own action and never also opens the tab.
         */
        private fun watch(component: Component) {
            if (component.mouseListeners.isEmpty()) component.addMouseListener(click)
            component.addMouseListener(pointer)
            if (component is Container) component.components.forEach { watch(it) }
        }

        /**
         * Whether the pointer is still anywhere on this row, so moving onto a child keeps it lit.
         * Bounds alone are not enough: an overlay painted above the session (the connection banner,
         * the modal blocker) can own the pointer while sitting inside the row's rectangle, and Swing
         * stops delivering to the row without it ever being left geometrically. Asking which
         * component is topmost treats a covered row as left, so the fill clears instead of sticking.
         */
        private fun inside(event: MouseEvent): Boolean {
            val point = SwingUtilities.convertPoint(event.component, event.point, panel)
            if (!panel.contains(point)) return false
            val pane = SwingUtilities.getRootPane(panel)?.layeredPane ?: return true
            val spot = SwingUtilities.convertPoint(event.component, event.point, pane)
            val top = SwingUtilities.getDeepestComponentAt(pane, spot.x, spot.y) ?: return true
            return SwingUtilities.isDescendingFrom(top, panel)
        }

        private fun hover(value: Boolean) {
            val before = panel.background
            panel.isHovered = value
            if (before.rgb == panel.background.rgb) return
            panel.repaint()
        }

        @RequiresEdt
        fun update(next: BackgroundAgent) {
            agent = next
            val running = next.status == BackgroundAgentStatus.RUNNING
            syncAvatar(next, running)
            // No icon at all while running (the avatar's own pulse already shows activity) or for a
            // cancelled agent (a user action, not something to flag) — `Stack` skips invisible
            // children and their gaps, so hiding this reclaims the slot instead of leaving blank
            // space reserved for it.
            val terminalIcon = if (running) null else statusIcon(next.status)
            statusGlyph.icon = terminalIcon
            statusGlyph.isVisible = terminalIcon != null
            title.text = titleFor(next)
            status.text = statusText(next.status)
            needsInput.isVisible = next.waiting
            action.isVisible = !readonly
            actionSlot.isVisible = !readonly
            action.icon = if (running) AllIcons.Actions.Suspend else AllIcons.Actions.Close
            val tip = KiloBundle.message(if (running) "session.header.agents.stop" else "session.header.agents.dismiss")
            action.toolTipText = tip
            action.accessibleContext.accessibleName = "$tip: ${titleFor(next)}"
        }

        @RequiresEdt
        private fun syncAvatar(next: BackgroundAgent, running: Boolean) {
            val colorSlot = avatarColor(next.session)
            if (next.session != avatarId || colorSlot != avatarColorSlot) {
                avatarId = next.session
                avatarColorSlot = colorSlot
                avatarStatic = AgentAvatar.static(avatarId, colorSlot)
                avatarRunning = AgentAvatar.running(avatarId, colorSlot)
            }
            avatar.icon = if (running) avatarRunning else avatarStatic
        }

        @RequiresEdt
        fun applyStyle(style: SessionEditorStyle) {
            title.font = style.regularFont
            title.foreground = style.editorForeground
            status.font = style.smallFont
            status.foreground = SessionUiStyle.Text.Secondary.foreground()
            needsInput.font = style.smallFont
        }

        /**
         * Agent row with the same rounded hover fill a collapsed session-view card header uses, over
         * the strip's raised surface instead of the backdrop. Stays non-opaque so the unhovered row
         * lets the strip surface through and the hovered fill keeps its rounded corners.
         */
        class HoverPanel : JPanel(BorderLayout(UiStyle.Gap.md(), 0)) {
            var isHovered = false

            override fun isOpaque(): Boolean = false

            override fun getBackground(): Color = if (isHovered) {
                SessionUiStyle.View.Surface.blockHoverBgColor()
            } else {
                SessionUiStyle.Colors.codeBlockBackground()
            }

            override fun paintComponent(g: Graphics) {
                super.paintComponent(g)
                if (!isHovered) return
                SessionSurface.fill(g, width, height, SessionUiStyle.View.Surface.blockHoverBgColor())
            }
        }
    }
}

/**
 * The aggregate (collapsed-summary) glyph for [status], and the per-row terminal glyph for a
 * completed/error/cancelled row (`Row.update` substitutes `null` while running instead of calling
 * this, since the avatar's own pulse already shows activity there). A cancelled agent deliberately
 * has no glyph at all — cancelling is a user action, not a problem to flag — rather than a blank icon
 * reserving the slot.
 */
private fun statusIcon(status: BackgroundAgentStatus): Icon? = when (status) {
    BackgroundAgentStatus.RUNNING -> SpinnerIcon.icon
    BackgroundAgentStatus.COMPLETED -> AllIcons.General.InspectionsOK
    BackgroundAgentStatus.CANCELLED -> null
    BackgroundAgentStatus.ERROR -> AllIcons.General.Error
}

private fun statusText(status: BackgroundAgentStatus): String = when (status) {
    BackgroundAgentStatus.RUNNING -> KiloBundle.message("session.header.agents.status.running")
    BackgroundAgentStatus.COMPLETED -> KiloBundle.message("session.header.agents.status.completed")
    BackgroundAgentStatus.CANCELLED -> KiloBundle.message("session.header.agents.status.cancelled")
    BackgroundAgentStatus.ERROR -> KiloBundle.message("session.header.agents.status.error")
}
