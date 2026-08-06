package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.DiffStatBadge
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.Icon
import javax.swing.JPanel

internal class WorktreeStatsView(
    private val openDiff: (() -> Unit)? = null,
) : JPanel(null) {
    companion object {
        private val UP: Icon = IconLoader.getIcon("/icons/arrow-up.svg", WorktreeStatsView::class.java)
        private val DOWN: Icon = IconLoader.getIcon("/icons/arrow-down-to-line.svg", WorktreeStatsView::class.java)
    }

    private val behind = count(DOWN)
    private val ahead = count(UP)
    private val diff = DiffStatBadge(0, 0, DiffStatBadge.Variant.COMPACT)
    private val pr = JBLabel()
    private val row = Stack.horizontal(UiStyle.Gap.sm()).next(behind).next(ahead).next(diff).next(pr)
    private var url: String? = null
    private var stats: WorktreeStatsDto? = null
    private var pull: WorktreePrDto? = null

    init {
        add(row)
        diff.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR).takeIf { openDiff != null } ?: Cursor.getDefaultCursor()
        diff.toolTipText = KiloBundle.message("worktree.stats.diff.tooltip", 0, 0)
        diff.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                openDiff?.invoke()
            }
        })
        pr.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        pr.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                url?.let(BrowserUtil::browse)
            }
        })
    }

    fun update(stats: WorktreeStatsDto?, pull: WorktreePrDto?) {
        if (this.stats == stats && this.pull == pull) return
        this.stats = stats
        this.pull = pull
        sync(stats, pull?.let { ActiveListBadge("#${it.number}", style(it.state)) }, pull?.url, pull?.let { KiloBundle.message("worktree.pr.tooltip", it.number, it.state.name.lowercase()) })
    }

    fun update(stats: WorktreeStatsDto?, badge: ActiveListBadge?) {
        if (this.stats == stats && pull == null && (pr.icon as? FilledBadgeIcon)?.text == badge?.text) return
        this.stats = stats
        this.pull = null
        sync(stats, badge, null, badge?.text)
    }

    private fun sync(stats: WorktreeStatsDto?, badge: ActiveListBadge?, link: String?, tip: String?) {
        val s = stats ?: WorktreeStatsDto("")
        behind.text = s.behind.toString()
        behind.toolTipText = KiloBundle.message("worktree.stats.behind.tooltip")
        behind.isVisible = s.behind > 0
        ahead.text = s.ahead.toString()
        ahead.toolTipText = KiloBundle.message("worktree.stats.ahead.tooltip")
        ahead.isVisible = s.ahead > 0
        diff.update(s.additions, s.deletions)
        diff.isVisible = s.additions > 0 || s.deletions > 0
        diff.toolTipText = KiloBundle.message("worktree.stats.diff.tooltip", s.additions, s.deletions)
        url = link
        pr.icon = badge?.let { FilledBadgeIcon(it.text, it.style) }
        pr.toolTipText = tip
        pr.isVisible = badge != null
        isVisible = behind.isVisible || ahead.isVisible || diff.isVisible || pr.isVisible
        revalidate()
        repaint()
    }

    override fun getPreferredSize(): Dimension {
        val ins = insets
        val size = row.preferredSize
        return Dimension(size.width + ins.left + ins.right, size.height + ins.top + ins.bottom)
    }

    override fun doLayout() {
        val ins = insets
        val size = row.preferredSize
        row.setBounds(ins.left, ins.top, minOf(size.width, width - ins.left - ins.right), minOf(size.height, height - ins.top - ins.bottom))
    }

    private fun count(icon: Icon) = JBLabel().apply {
        this.icon = icon
        iconTextGap = UiStyle.Gap.xs()
        font = JBFont.small()
        foreground = UiStyle.Colors.weak()
        border = JBUI.Borders.empty()
    }
}

internal fun style(state: GhState): UiStyle.Badge.Style = when (state) {
    GhState.OPEN -> UiStyle.Badge.Primary
    GhState.DRAFT -> UiStyle.Badge.Secondary
    GhState.MERGED -> UiStyle.Badge.Highlight
    GhState.CLOSED -> UiStyle.Badge.Alert
}
