package ai.kilocode.client.ui.list

import ai.kilocode.client.agentManager.worktree.WorktreeStatsView
import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.LayeredOverlayPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.RelativeFont
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.IconUtil
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import ai.kilocode.rpc.dto.WorktreeStatsDto
import java.awt.AlphaComposite
import java.awt.BasicStroke
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.RenderingHints
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

internal class ActiveListRenderer(
    private val model: CollectionListModel<ActiveListItem>,
    private val cfg: ActiveListConfig = ActiveListConfig.Equal,
) : JPanel(BorderLayout()), ListCellRenderer<ActiveListItem> {
    constructor(
        model: CollectionListModel<ActiveListItem>,
        cfg: ActiveListConfig = ActiveListConfig.Equal,
        menu: ActiveListMenu<*>?,
    ) : this(model, cfg) {
        this.menu = menu
        if (menu == null) return
        glyph.update(activeListMenuCell())
        glyph.isVisible = false
        // Mirror the flush leading icon: drop the row's trailing inset and let the empty-icon spacer
        // hold a dedicated menu column at the content edge. The overlay glyph then floats over that
        // same slot, revealed on hover.
        row.border = JBUI.Borders.empty(UiStyle.Gap.md(), 0, UiStyle.Gap.md(), 0)
        (row.layout as BorderLayout).hgap = 0
        mark.border = JBUI.Borders.emptyRight(UiStyle.Gap.md())
        val tail = JPanel(BorderLayout())
        UiStyle.Components.transparent(tail)
        tail.add(endPane, BorderLayout.CENTER)
        tail.add(spacer, BorderLayout.EAST)
        row.remove(endPane)
        row.add(tail, BorderLayout.EAST)
        // Stretch the glyph column top-to-bottom so its whole height is a click target; the icon
        // stays centered within by the label's own alignment. Width stays at the icon's preferred
        // size, pinned flush to the right edge.
        layers.addOverlay(glyph) { host, child ->
            val width = child.preferredSize.width.coerceAtMost(host.width)
            Rectangle((host.width - width).coerceAtLeast(0), 0, width, host.height)
        }
    }

    private var menu: ActiveListMenu<*>? = null
    private val insets = JBUI.CurrentTheme.Popup.separatorLabelInsets()
    private val sep = GroupHeaderSeparator(insets)
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    // Pin the glyph to the top of the label so a stretched icon column keeps the icon on the
    // first text line instead of centering it across a multi-line row.
    private val icon = JBLabel().apply { verticalAlignment = SwingConstants.TOP }
    private val mark = icon.align(HAlign.CENTER, VAlign.CENTER)
    private val title = SimpleColoredComponent()
    private val badges = Stack.horizontal()
    // Title in CENTER clips when the group is narrow; trailing tags in EAST keep their full
    // preferred width. A squeezed row sacrifices the title text but never drops the tags.
    private val titleGroup = JPanel(BorderLayout(UiStyle.Gap.xs(), 0)).apply {
        add(title, BorderLayout.CENTER)
        add(badges, BorderLayout.EAST)
    }
    // Pin the title+badges group to the leading edge so badges trail the title text directly
    // instead of drifting to the far right of the row.
    private val header = titleGroup.align(HAlign.LEFT, VAlign.CENTER)
    private val desc = JBLabel()
    private val metrics = WorktreeStatsView()
    private val metricsPane = metrics.align(HAlign.RIGHT, VAlign.CENTER)
    // The description (branch) line carries the changes/PR metrics on its trailing edge so they sit
    // on the branch row instead of spanning the full row height.
    private val descLine = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(desc, BorderLayout.CENTER)
        add(metricsPane, BorderLayout.EAST)
    }
    private val text = Stack.vertical().next(header).next(descLine)
    private val textPane = text.align(HAlign.TRACK, VAlign.CENTER)
    private val trail = JBLabel().apply { horizontalAlignment = SwingConstants.RIGHT }
    private val trailPane = trail.align(HAlign.RIGHT, VAlign.CENTER)
    private val endPane = JPanel(BorderLayout()).apply {
        add(trailPane, BorderLayout.CENTER)
    }
    private val cells = Stack.horizontal(activeListCellGap())
    private val cellPane = cells.align(HAlign.RIGHT, VAlign.CENTER)
    private val pill = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
        add(cellPane, BorderLayout.CENTER)
    }
    // The dropdown button keeps the overlay approach: a real empty-icon [spacer] holds the trailing
    // column in the row layout, and the [glyph] button floats over that slot — revealed on hover —
    // so the row body is laid out beside the column and never shifts. Both are bare (no border) so
    // the icon sits flush against the content edge, mirroring the flush leading icon.
    private val glyph = ActiveListActionCell()
    private val spacer = JBLabel(EmptyIcon.create(AllIcons.Actions.More))
    // Width of the dropdown column, used to offset the action pill when a list opts into both.
    private val reserve: Int by lazy { glyph.preferredSize.width }
    private val row = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(mark, BorderLayout.WEST)
        add(textPane, BorderLayout.CENTER)
        add(endPane, BorderLayout.EAST)
    }
    private val layers = LayeredOverlayPanel(
        content = JPanel(BorderLayout()).apply { add(row, BorderLayout.CENTER) },
    )
    private val wrap = PickerRow()
    private var bodyHeight: Int? = null
    private var gap = false

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(
            layers,
            layers.content,
            row,
            mark,
            icon,
            title,
            badges,
            titleGroup,
            header,
            text,
            textPane,
            desc,
            descLine,
            metrics,
            metricsPane,
            trail,
            trailPane,
            endPane,
            cells,
            cellPane,
            glyph,
            spacer,
        )
        row.border = JBUI.Borders.empty(
            UiStyle.Gap.md(),
            0,
            UiStyle.Gap.md(),
            UiStyle.Gap.pad(),
        )
        layers.addOverlay(pill) { host, child ->
            val size = child.preferredSize
            val gap = if (menu != null) reserve else 0
            Rectangle(
                (host.width - size.width - UiStyle.Gap.pad() - gap).coerceAtLeast(0),
                ((host.height - size.height) / 2).coerceAtLeast(0),
                size.width.coerceAtMost(host.width),
                size.height.coerceAtMost(host.height),
            )
        }
        wrap.setContent(layers)
        add(top, BorderLayout.NORTH)
        add(wrap, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out ActiveListItem>,
        value: ActiveListItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val active = selected && (focused || list.hasFocus() || (list as? ActiveListActive)?.active() == true)
        val fg = UIUtil.getListForeground(active, active || focused)
        val weak = UiStyle.Colors.weak()
        val titleFg = if (value.progress != null) weak else fg
        val section = activeListSectionTitle(model.items, index)

        background = list.background
        top.background = list.background
        wrap.update(list, selected, active)
        syncHeader(section, index)

        if (value is ActiveListGap) {
            gap = true
            layers.isVisible = false
            pill.isVisible = false
            glyph.isVisible = false
            wrap.update(list, false, false)
            wrap.setPreferredSize(Dimension(0, bodyHeight ?: value.height))
            activeListInvalidate(this)
            return this
        }
        gap = false
        layers.isVisible = true

        title.clear()
        // Bold carries most rows by default: the description under it and the icon beside it both
        // render in the muted secondary color, so cfg.title separates the two lines when enabled.
        val style = if (cfg.title == ActiveListWeight.BOLD) SimpleTextAttributes.STYLE_BOLD else SimpleTextAttributes.STYLE_PLAIN
        title.append(value.title, SimpleTextAttributes(style, titleFg))
        value.note?.takeIf { it.isNotBlank() }?.let {
            title.append("  $it", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
        syncBadges(value)
        // A selected row paints its title in the selection foreground; recolor a tinted glyph to
        // match so it reads as part of the highlighted text. Colored status icons opt out and keep
        // their own hue.
        icon.icon = value.icon?.let { if (active && value.tinted) IconUtil.colorize(it, fg, keepBrightness = false) else it }
        mark.isVisible = value.icon != null
        val note = if (cfg.description) value.description.orEmpty() else ""
        desc.text = note
        desc.isVisible = note.isNotBlank()
        desc.border = if (cfg.descriptionIndent && desc.isVisible) {
            JBUI.Borders.emptyLeft(UiStyle.Gap.sm())
        } else {
            JBUI.Borders.empty()
        }
        desc.foreground = weak
        val data = if (value.progress != null) null else value.metrics
        metrics.update(data?.let { WorktreeStatsDto("", it.additions, it.deletions, it.ahead, it.behind) }, data?.pr, data?.prTooltip ?: data?.pr?.text)
        metrics.setActions(data?.onChanges, data?.onPr)
        val end = value.progress ?: value.trailing.orEmpty()
        trail.text = end
        trail.isVisible = end.isNotBlank() && data == null
        metrics.isVisible = data != null
        // Hide the wrapper too so a metrics-less row does not reserve the trailing gap on its
        // description, and collapse the whole second row when it would be empty so title-only rows
        // stay vertically centered.
        metricsPane.isVisible = metrics.isVisible
        descLine.isVisible = desc.isVisible || metrics.isVisible
        trail.foreground = weak

        val hovered = (list as? ActiveListActive)?.hoveredIndex() == index
        val show = if (cfg.hoverActions) list.isEnabled && selected && hovered else active && list.isEnabled
        syncCells(value, show)
        cellPane.isVisible = cells.isVisible
        pill.isVisible = cells.isVisible
        menu?.let { glyph.isVisible = list.isEnabled && hovered && it.available(value) }
        // Match the row's own background so the pill never paints a focused-selection highlight
        // on a row that is not the focused selection (e.g. a hovered, unselected row).
        pill.background = if (selected && list.isEnabled) UIUtil.getListBackground(true, active) else list.background
        val height = bodyHeight
        wrap.setPreferredSize(height?.let { Dimension(0, it) })
        // Neither the content mutations above nor setPreferredSize invalidate reliably: a same-size
        // icon swap, an equal label text, or an explicit preferred size leave the tree valid, and a
        // valid subtree keeps the sizes it was measured with for another row.
        activeListInvalidate(this)
        return this
    }

    private fun syncHeader(section: String?, index: Int) {
        sep.caption = section
        sep.setHideLine(!cfg.divider || index == 0)
        val font = if (cfg.header == ActiveListWeight.BOLD) {
            RelativeFont.BOLD.derive(sep.font)
        } else {
            RelativeFont.PLAIN.derive(sep.font)
        }
        if (sep.font != font) sep.font = font
        top.isVisible = section != null
        top.setPreferredSize(section?.let {
            val height = sep.preferredSize.height
                .coerceAtLeast(sep.getFontMetrics(sep.font).height + insets.top + insets.bottom)
            Dimension(0, height + JBUI.scale(2))
        })
    }

    override fun paintChildren(g: Graphics) {
        super.paintChildren(g)
        if (!gap) return
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val inset = UiStyle.Gap.xs()
            val arc = UiStyle.Arc.component()
            val x = wrap.x + inset
            val y = wrap.y + inset
            val width = (wrap.width - inset * 2 - 1).coerceAtLeast(0)
            val height = (wrap.height - inset * 2 - 1).coerceAtLeast(0)
            g2.color = JBUI.CurrentTheme.List.Selection.background(true)
            g2.stroke = BasicStroke(
                JBUI.scale(1).toFloat(),
                BasicStroke.CAP_ROUND,
                BasicStroke.JOIN_ROUND,
                0f,
                floatArrayOf(JBUI.scale(3).toFloat(), JBUI.scale(3).toFloat()),
                0f,
            )
            g2.drawRoundRect(x, y, width, height, arc, arc)
        } finally {
            g2.dispose()
        }
    }

    fun setBodyHeight(height: Int?) {
        if (bodyHeight == height) return
        bodyHeight = height
    }

    fun bodyPreferredHeight(
        list: JList<out ActiveListItem>,
        value: ActiveListItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): Int {
        val fixed = bodyHeight
        bodyHeight = null
        getListCellRendererComponent(list, value, index, selected, focused)
        val height = wrap.preferredSize.height
        bodyHeight = fixed
        return height
    }

    /**
     * Paints the row body — the section-header band excluded — into an image, together with the
     * body's origin inside the cell so callers can map a grab point in cell coordinates onto the
     * image. Rendered as the focused selection so the dragged copy reads as a lifted row.
     */
    fun rowImage(
        list: JList<out ActiveListItem>,
        value: ActiveListItem,
        index: Int,
        width: Int,
    ): Pair<BufferedImage, Point>? {
        getListCellRendererComponent(list, value, index, true, true)
        val size = preferredSize
        setBounds(0, 0, width, size.height)
        activeListLayout(this)
        if (wrap.width <= 0 || wrap.height <= 0) return null
        val image = UIUtil.createImage(list, wrap.width, wrap.height, BufferedImage.TYPE_INT_ARGB)
        val g2 = image.createGraphics()
        try {
            g2.composite = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.9f)
            // paint() already treats the graphics origin as the body's own top-left, so the body's
            // offset inside the cell must not be applied again: on a row that opens a section that
            // offset is the header band, and shifting by it would lift the copy off the image and
            // leave most of it blank.
            wrap.paint(g2)
        } finally {
            g2.dispose()
        }
        return image to Point(wrap.x, wrap.y)
    }

    private fun syncBadges(item: ActiveListItem) {
        val items = if (item.progress != null) emptyList() else item.badges
        while (badges.componentCount > items.size) badges.remove(badges.componentCount - 1)
        while (badges.componentCount < items.size) {
            badges.add(JBLabel().apply {
                border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
            })
        }
        badges.isVisible = items.isNotEmpty()
        for (i in items.indices) {
            val badge = items[i]
            val label = badges.getComponent(i) as JBLabel
            val current = label.icon as? FilledBadgeIcon
            if (current?.text != badge.text || current.style != badge.style) {
                label.icon = FilledBadgeIcon(badge.text, badge.style)
            }
        }
    }

    private fun syncCells(item: ActiveListItem, selected: Boolean) {
        val visible = activeListVisibleCells(item, selected)
        while (cells.componentCount > visible.size) cells.remove(cells.componentCount - 1)
        while (cells.componentCount < visible.size) cells.add(ActiveListActionCell())
        cells.isVisible = visible.isNotEmpty()
        for (i in visible.indices) {
            (cells.getComponent(i) as ActiveListActionCell).update(visible[i])
        }
    }
}

internal interface ActiveListActive {
    fun active(): Boolean

    fun hoveredIndex(): Int = -1
}

internal class ActiveListActionCell : JBLabel(), ActiveListHitCell {
    private var cell: ActiveListCell? = null

    override var cellId: String = ""
        private set

    fun update(cell: ActiveListCell) {
        this.cell = cell
        cellId = cell.id
        text = if (cell.iconOnly) "" else cell.label
        icon = cell.icon
        toolTipText = (cell.tooltip ?: cell.label).takeIf { it.isNotBlank() }
        horizontalAlignment = SwingConstants.CENTER
        isEnabled = cell.enabled
        if (!cell.iconOnly) UiStyle.Components.actionLabel(this, isEnabled)
    }

    override fun cellEnabled(): Boolean = cell?.enabled ?: false

    override fun cellCursor(): Int = cell?.cursor ?: Cursor.HAND_CURSOR

    override fun cellTooltip(): String? = cell?.let { it.tooltip ?: it.label }?.takeIf { it.isNotBlank() }

    override fun cellAction(): (() -> Unit)? = cell?.action

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        if (text.isNotBlank()) UiStyle.Components.actionLabel(this, enabled)
    }
}
