package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ACTIVE_LIST_CHANGES_CELL
import ai.kilocode.client.ui.list.ACTIVE_LIST_DIRTY_CELL
import ai.kilocode.client.ui.list.ActiveListHitCell
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JPanel

/**
 * The trailing ahead/behind/diff badges of a worktree row.
 *
 * Uses a real layout manager on purpose: a `null` layout resolves min/preferred size through the
 * peer, which reports the component's *current* size. Inside the list this view is a single render
 * stamp reused for every row, and [Stack] and [ai.kilocode.client.ui.layout.Align] clamp a child's
 * preferred width into its `[min, max]` range - so a peer-reported minimum would carry the previous
 * row's width into the next row's layout and drift the badges off their hit regions.
 */
internal class WorktreeStatsView(
    openDiff: (() -> Unit)? = null,
    fill: Boolean = true,
) : JPanel(BorderLayout()) {
    companion object {
        private val UP: Icon = IconLoader.getIcon("/icons/arrow-up.svg", WorktreeStatsView::class.java)
        private val DOWN: Icon = IconLoader.getIcon("/icons/arrow-down-to-line.svg", WorktreeStatsView::class.java)
    }

    private val behind = count(DOWN)
    private val ahead = count(UP)
    private val diff = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT, fill = fill)
    // Muted and unfilled so it reads as a different baseline than the committed-diff badge above.
    private val dirty = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT, fill = false)
    private val change = Stack.horizontal(UiStyle.Gap.sm()).next(behind).next(ahead).next(diff)
    // The change and dirty badges are hit regions so the list can drive their clicks: inside
    // the list the view is a render stamp whose own mouse listeners never fire, so the ActiveList
    // reads these ids back and routes the click. Standalone (toolbar) usage keeps its own listeners
    // below.
    private val changeHit = HitRegion(ACTIVE_LIST_CHANGES_CELL).apply { add(change, BorderLayout.CENTER) }
    private val dirtyHit = HitRegion(ACTIVE_LIST_DIRTY_CELL).apply { add(dirty, BorderLayout.CENTER) }
    private val row = Stack.horizontal(UiStyle.Gap.md()).next(changeHit).next(dirtyHit)
    private var state: State? = null

    init {
        add(row, BorderLayout.CENTER)
        changeHit.act = openDiff
        diff.toolTipText = KiloBundle.message("worktree.stats.tooltip", 0, 0, 0, 0)
        installClick(changeHit, object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                changeHit.act?.invoke()
            }
        })
        installClick(dirtyHit, object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                dirtyHit.act?.invoke()
            }
        })
        applyCursors()
    }

    /**
     * Replaces the click handlers, used by the list renderer to bind each row's changes/dirty
     * actions to the single reused stamp. Standalone usage leaves the constructor defaults in place.
     */
    fun setActions(onChanges: (() -> Unit)?, onDirty: (() -> Unit)? = null) {
        changeHit.act = onChanges
        dirtyHit.act = onDirty
        applyCursors()
    }

    fun update(
        stats: WorktreeStatsDto?,
        dirtyAdd: Int = 0,
        dirtyDel: Int = 0,
        dirtyFiles: Int = 0,
    ) {
        sync(
            State(
                stats,
                dirtyAdd,
                dirtyDel,
                dirtyFiles,
            ),
        )
    }

    /**
     * Applies [next] unless it is already rendered. The memo key must cover everything this method
     * writes: inside the list one instance renders every row, so a field left out of the key would
     * carry another row's badge, tooltip, or visibility.
     */
    private fun sync(next: State) {
        if (state == next) return
        state = next
        val s = next.stats ?: WorktreeStatsDto("")
        behind.text = s.behind.toString()
        behind.toolTipText = KiloBundle.message("worktree.stats.behind.tooltip")
        behind.isVisible = s.behind > 0
        ahead.text = s.ahead.toString()
        ahead.toolTipText = KiloBundle.message("worktree.stats.ahead.tooltip")
        ahead.isVisible = s.ahead > 0
        diff.update(s.additions, s.deletions)
        diff.isVisible = s.additions > 0 || s.deletions > 0
        // One descriptive tooltip for the whole changes region: ahead/behind, the +/- diff, and what
        // clicking does.
        val changeTip = KiloBundle.message("worktree.stats.tooltip", s.ahead, s.behind, s.additions, s.deletions)
        diff.toolTipText = changeTip
        changeHit.tip = changeTip
        changeHit.toolTipText = changeTip
        dirty.update(next.dirtyAdd, next.dirtyDel)
        dirty.isVisible = next.dirtyFiles > 0
        val dirtyTip = KiloBundle.message("worktree.dirty.tooltip", next.dirtyFiles, next.dirtyAdd, next.dirtyDel)
        dirty.toolTipText = dirtyTip
        dirtyHit.tip = dirtyTip
        dirtyHit.toolTipText = dirtyTip
        dirtyHit.isVisible = dirty.isVisible
        val changesVisible = behind.isVisible || ahead.isVisible || diff.isVisible
        changeHit.isVisible = changesVisible
        isVisible = changesVisible || dirtyHit.isVisible
        applyCursors()
        revalidate()
        repaint()
    }

    private fun applyCursors() {
        applyCursor(changeHit, changeHit.act != null)
        applyCursor(dirtyHit, dirtyHit.act != null)
    }

    private fun actionCursor(active: Boolean) =
        if (active) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()

    private fun installClick(comp: Component, listener: MouseAdapter) {
        comp.addMouseListener(listener)
        if (comp is Container) comp.components.forEach { installClick(it, listener) }
    }

    private fun applyCursor(comp: Component, active: Boolean) {
        comp.cursor = actionCursor(active)
        if (comp is Container) comp.components.forEach { applyCursor(it, active) }
    }

    private fun count(icon: Icon) = JBLabel().apply {
        this.icon = icon
        iconTextGap = UiStyle.Gap.xs()
        font = JBFont.small()
        foreground = UiStyle.Colors.weak()
        border = JBUI.Borders.empty()
    }

    internal fun dirtyBadgeForTest() = dirty

    internal fun dirtyHitForTest() = dirtyHit

    /** Everything [sync] renders, so a repeated row can be skipped without leaking stale state. */
    private data class State(
        val stats: WorktreeStatsDto?,
        val dirtyAdd: Int,
        val dirtyDel: Int,
        val dirtyFiles: Int,
    )

    /** A badge wrapper the ActiveList hit-tests for clicks, cursor, and tooltip. */
    internal class HitRegion(override val cellId: String) : JPanel(BorderLayout()), ActiveListHitCell {
        var act: (() -> Unit)? = null
        var tip: String? = null

        init {
            isOpaque = false
        }

        override fun cellEnabled(): Boolean = act != null && isVisible

        override fun cellCursor(): Int = Cursor.HAND_CURSOR

        override fun cellTooltip(): String? = tip

        override fun cellAction(): (() -> Unit)? = act
    }
}
