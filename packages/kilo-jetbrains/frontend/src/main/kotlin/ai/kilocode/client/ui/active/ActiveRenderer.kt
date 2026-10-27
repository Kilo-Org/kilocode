package ai.kilocode.client.ui.active

import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FadeText
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.LayeredOverlayPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.LayoutPass
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.IconUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.AlphaComposite
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import java.awt.image.BufferedImage
import com.intellij.ui.components.JBTextArea
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Unscaled gap around a row's badge columns.
 *
 * Read from the same theme key as [JBUI.CurrentTheme.ActionsList.elementIconGap] but left unscaled, so
 * one value can feed both the layout gaps (which need pixels) and [JBUI.Borders] (which scales what it
 * is handed).
 */
private fun activeIconGap() = JBUI.getInt("ActionsList.icon.gap", UiStyle.Gap.MD)

/**
 * Whether row text that does not fit fades into the row background instead of stopping at a bare cut.
 *
 * On by default. Off leaves the cut exposed, which is legible but reads as the end of the text rather than
 * the middle of it — the escape hatch for a surface where the fade is wrong, such as a theme that paints a
 * row background the renderer cannot name.
 */
private fun activeFade() = Registry.`is`("kilo.list.fade", true)

internal data class ActiveRenderState(
    val item: ActiveItem,
    val selected: Boolean,
    val focused: Boolean,
    val active: Boolean,
    val hovered: Boolean,
    val enabled: Boolean,
    val background: Color,
    val selectionColor: Color?,
    val paintSelection: Boolean,
    val backdrop: Color?,
    val foreground: Color,
    val pillBackground: Color,
    val width: Int,
    val actionsVisible: Boolean,
    val menuVisible: Boolean,
    val opaque: Boolean = true,
    val bodyHeight: Int? = null,
    val interactive: Boolean = true,
)

internal class ActiveRenderer(
    private val cfg: ActiveConfig = ActiveConfig.Equal,
    menu: ActiveMenu<*>? = null,
) : JPanel(BorderLayout()) {
    private var menu: ActiveMenu<*>? = menu

    // Pin the glyph to the top of the label so a stretched icon column keeps the icon on the
    // first text line instead of centering it across a multi-line row.
    private val icon = JBLabel().apply { verticalAlignment = SwingConstants.TOP }
    private val mark = icon.align(HAlign.CENTER, cfg.iconAlignment.align())
    private val title = FadeText()
    private val leading = Stack.horizontal(JBUI.scale(activeIconGap()))
    private val badges = Stack.horizontal(JBUI.scale(activeIconGap()))
    private val secondary = Stack.horizontal(UiStyle.Gap.md())
    // Title in CENTER clips when the group is narrow; tags in WEST/EAST keep their full preferred
    // width. A squeezed row sacrifices the title text but never drops the tags.
    private val titleGroup = JPanel(BorderLayout(UiStyle.Gap.xs(), 0)).apply {
        add(leading, BorderLayout.WEST)
        add(title, BorderLayout.CENTER)
        add(badges, BorderLayout.EAST)
    }
    // Pin the title+badges group to the leading edge so badges trail the title text directly instead of
    // drifting to the far right of the row. A list that opts into [ActiveConfig.badgesRight] gets
    // the group stretched across the row instead, which lands its badges on the same trailing edge as
    // the metrics and secondary badges below them.
    private val header = titleGroup.align(if (cfg.badgesRight) HAlign.FIT else HAlign.LEFT, VAlign.CENTER)
    // Carries the description as a [FadeText] rather than the JBLabel it used to be, so both lines of a
    // row clip the same way: cut and faded, not ellipsed through the label UI. The internal padding and
    // border a colored component ships with are cleared to keep the label's own geometry, which would
    // otherwise indent the line by a few pixels and grow every row.
    private val desc = FadeText().apply {
        ipad = JBUI.emptyInsets()
        myBorder = null
    }
    // Only built when a caller opts into wrapping (board-style rows); every other list keeps the
    // single-line faded [desc] and pays nothing for this. Measured at its own current width, which
    // [activeListLayout] assigns before anything reads its preferred size — see the wrap block near
    // the end of [getListCellRendererComponent].
    private val descWrap: ActiveWrapText? = if (cfg.wrapDescription) ActiveWrapText() else null
    private val descBody: JComponent = descWrap ?: desc
    private val metrics = ActiveChangesCell()
    private val details = Stack.horizontal(UiStyle.Gap.md()).next(metrics).next(secondary)
    private val detailsPane = details.align(HAlign.RIGHT, VAlign.CENTER)
    private val descLine = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(descBody, BorderLayout.CENTER)
        add(detailsPane, BorderLayout.EAST)
    }
    private val text = Stack.vertical().next(header).next(descLine)
    private val textPane = text.align(HAlign.TRACK, VAlign.CENTER)
    private val trail = JBLabel().apply { horizontalAlignment = SwingConstants.RIGHT }
    private val trailPane = trail.align(HAlign.RIGHT, VAlign.CENTER)
    private val endPane = JPanel(BorderLayout()).apply {
        add(trailPane, BorderLayout.CENTER)
    }
    private val cells = Stack.horizontal(activeCellGap())
    private val cellPane = cells.align(HAlign.RIGHT, VAlign.CENTER)
    private val pill = JPanel(BorderLayout()).apply {
        add(cellPane, BorderLayout.CENTER)
    }
    // The dropdown button keeps the overlay approach: a real empty-icon [spacer] holds the trailing
    // column in the row layout, and the [glyph] button floats over that slot — revealed on hover —
    // so the row body is laid out beside the column and never shifts. Both are bare (no border) so
    // the icon sits flush against the content edge, mirroring the flush leading icon.
    private val glyph = ActiveActionCell()
    private val spacer = JBLabel(EmptyIcon.create(AllIcons.Actions.More))
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
    // JPanel's constructor calls updateUI() before any field below exists, so guard the refresh.
    private var wired = false

    init {
        isOpaque = true
        UiStyle.Components.transparent(
            layers,
            layers.content,
            row,
            mark,
            icon,
            title,
            leading,
            badges,
            titleGroup,
            header,
            text,
            textPane,
            desc,
            descLine,
            metrics,
            secondary,
            details,
            detailsPane,
            trail,
            trailPane,
            endPane,
            cells,
            cellPane,
            glyph,
            spacer,
        )
        descWrap?.let { UiStyle.Components.transparent(it) }
        layers.addOverlay(pill) { host, child ->
            val size = child.preferredSize
            // The dropdown column, so the pill clears it when a list opts into both.
            val gap = if (menu != null) glyph.preferredSize.width else 0
            Rectangle(
                (host.width - size.width - UiStyle.Gap.pad() - gap).coerceAtLeast(0),
                ((host.height - size.height) / 2).coerceAtLeast(0),
                size.width.coerceAtMost(host.width),
                size.height.coerceAtMost(host.height),
            )
        }
        wrap.setContent(layers)
        if (menu != null) {
            glyph.update(activeMenuCell())
            glyph.isVisible = false
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
        add(wrap, BorderLayout.CENTER)
        wired = true
        syncScale()
    }

    /**
     * Re-derives every scale-dependent value in the stamp.
     *
     * The renderer is one long-lived component reused for every row, and both a layout manager's gap
     * and an assigned border capture their pixel width when they are created. An IDE zoom moves the
     * JBUI user scale without touching row data, so anything captured in a constructor would keep its
     * pre-zoom size while the fonts and icons around it grow. Everything DPI-derived therefore lives
     * here and is re-applied from [updateUI].
     */
    private fun syncScale() {
        val iconGap = JBUI.scale(activeIconGap())
        leading.space = iconGap
        badges.space = iconGap
        secondary.space = UiStyle.Gap.md()
        details.space = UiStyle.Gap.md()
        cells.space = activeCellGap()
        (titleGroup.layout as BorderLayout).hgap = UiStyle.Gap.xs()
        (descLine.layout as BorderLayout).hgap = UiStyle.Gap.md()
        pill.border = JBUI.Borders.empty(UiStyle.Gap.SM)
        // Mirror the flush leading icon when a menu column is present: drop the row's trailing inset
        // and let the empty-icon spacer hold a dedicated column at the content edge. The overlay glyph
        // then floats over that same slot, revealed on hover.
        (row.layout as BorderLayout).hgap = if (menu == null) UiStyle.Gap.md() else 0
        row.border = if (menu == null) {
            JBUI.Borders.empty(UiStyle.Gap.MD, 0, UiStyle.Gap.MD, UiStyle.Gap.PAD)
        } else {
            JBUI.Borders.empty(UiStyle.Gap.MD, 0, UiStyle.Gap.MD, 0)
        }
        mark.border = if (menu == null) JBUI.Borders.empty() else JBUI.Borders.emptyRight(UiStyle.Gap.MD)
    }

    override fun updateUI() {
        super.updateUI()
        if (!wired) return
        syncScale()
    }

    // The stamp is invalidated wholesale for every row (see [activeListInvalidate]), so without a pass each
    // nested Stack/Align re-measures its whole subtree for every size it is asked. The painting validate and
    // every row-height read run as one [LayoutPass] each, which measures every container once.
    override fun validate() = LayoutPass.measure { super.validate() }

    override fun getPreferredSize(): Dimension = LayoutPass.measure { super.getPreferredSize() }

    @RequiresEdt
    fun render(state: ActiveRenderState): JComponent {
        val value = state.item
        val weak = UiStyle.Colors.weak()
        val titleFg = if (value.progress != null) weak else state.foreground

        isOpaque = state.opaque
        background = state.background
        wrap.update(state.background, state.selectionColor, state.opaque, state.paintSelection)

        // Text that runs out of room is cut and faded rather than ellipsed, so the row spends every pixel
        // it has on the text itself. The fade blends into whatever the row painted behind the line.
        val backdrop = if (activeFade()) state.backdrop else null
        title.backdrop = backdrop
        desc.backdrop = backdrop

        title.clear()
        // Bold carries most rows by default: the description under it and the icon beside it both
        // render in the muted secondary color, so cfg.title separates the two lines when enabled.
        val style = if (cfg.title == ActiveWeight.BOLD) SimpleTextAttributes.STYLE_BOLD else SimpleTextAttributes.STYLE_PLAIN
        title.append(value.title, SimpleTextAttributes(style, titleFg))
        value.note?.takeIf { it.isNotBlank() }?.let {
            title.append("  $it", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
        // The row's ordinary text color rather than the muted one: a labelled glyph is a figure the user is
        // meant to read, and the muted tone made it fainter than the neutral glyph beside it. Selection
        // aware, so a highlighted row does not leave the count dark on dark blue.
        syncBadges(value, state.foreground)
        // A selected row paints its title in the selection foreground; recolor a tinted glyph to
        // match so it reads as part of the highlighted text. Colored status icons opt out and keep
        // their own hue.
        icon.icon = value.icon?.let {
            if (state.active && value.tinted) IconUtil.colorize(it, state.foreground, keepBrightness = false) else it
        }
        mark.isVisible = value.icon != null
        val note = if (cfg.description) value.description.orEmpty() else ""
        if (descWrap != null) {
            if (descWrap.text != note) descWrap.text = note
            descWrap.foreground = weak
            descWrap.isVisible = note.isNotBlank()
            descWrap.border = if (cfg.descriptionIndent && descWrap.isVisible) {
                JBUI.Borders.emptyLeft(UiStyle.Gap.SM)
            } else {
                JBUI.Borders.empty()
            }
        } else {
            desc.clear()
            if (note.isNotBlank()) desc.append(note, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
            desc.isVisible = note.isNotBlank()
            desc.border = if (cfg.descriptionIndent && desc.isVisible) {
                JBUI.Borders.emptyLeft(UiStyle.Gap.SM)
            } else {
                JBUI.Borders.empty()
            }
        }
        val data = if (value.progress != null) null else value.metrics
        metrics.isEnabled = state.enabled && !value.disabled
        metrics.update(data)
        val end = value.progress ?: value.trailing.orEmpty()
        trail.text = end
        trail.isVisible = end.isNotBlank() && data == null
        detailsPane.isVisible = metrics.isVisible || secondary.isVisible
        descLine.isVisible = descBody.isVisible || detailsPane.isVisible
        trail.foreground = weak

        syncCells(value, state.actionsVisible)
        if (!state.interactive) {
            cells.components.forEach { it.isVisible = false }
            cells.isVisible = false
            metrics.isEnabled = false
        }
        cellPane.isVisible = cells.isVisible
        pill.isVisible = cells.isVisible
        glyph.isVisible = state.menuVisible
        // Match the row's own background so the pill never paints a focused-selection highlight
        // on a row that is not the focused selection (e.g. a hovered, unselected row).
        pill.background = state.pillBackground
        val height = state.bodyHeight
        wrap.setPreferredSize(height?.let { Dimension(0, it) })
        if (cfg.wrapDescription) {
            // [descWrap] answers its own preferred height from its current width (see
            // [ActiveWrapText.getPreferredSize]), but nothing has assigned it a width yet. A real
            // (not preferred-size-only) layout pass at the row's width cascades the real column
            // width down through every BorderLayout/Stack/Align level before anything below reads a
            // preferred size. The placeholder height stays minimal because absolutely-positioned
            // overlay children report their current bounds as preferred size.
            setBounds(0, 0, state.width.coerceAtLeast(1), 1)
            activeLayout(this)
        }
        // Neither the content mutations above nor setPreferredSize invalidate reliably: a same-size
        // icon swap, an equal label text, or an explicit preferred size leave the tree valid, and a
        // valid subtree keeps the sizes it was measured with for another row.
        activeInvalidate(this)
        return this
    }

    /** The reusable row body, without list-only chrome such as section bands. */
    fun body(): JComponent = wrap

    fun setBodyHeight(height: Int?) {
        if (bodyHeight == height) return
        bodyHeight = height
    }

    fun bodyPreferredHeight(state: ActiveRenderState): Int {
        val fixed = bodyHeight
        bodyHeight = null
        render(state.copy(bodyHeight = null))
        val height = LayoutPass.measure { wrap.preferredSize.height }
        bodyHeight = fixed
        return height
    }

    /**
     * Paints the row body into an image, together with the body's origin inside the cell so callers
     * can map a grab point in cell coordinates onto the image. Rendered as the focused selection so
     * the dragged copy reads as a lifted row.
     */
    fun rowImage(state: ActiveRenderState, width: Int): Pair<BufferedImage, Point>? {
        render(state.copy(selected = true, focused = true, active = true, actionsVisible = true))
        val size = preferredSize
        setBounds(0, 0, width, size.height)
        activeLayout(this)
        if (wrap.width <= 0 || wrap.height <= 0) return null
        val image = UIUtil.createImage(this, wrap.width, wrap.height, BufferedImage.TYPE_INT_ARGB)
        val g2 = image.createGraphics()
        try {
            g2.composite = AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.9f)
            wrap.paint(g2)
        } finally {
            g2.dispose()
        }
        return image to Point(wrap.x.coerceAtLeast(0), wrap.y.coerceAtLeast(0))
    }

    private fun syncBadges(item: ActiveItem, color: Color) {
        val hidden = item.progress != null
        val gap = activeIconGap()
        leading.border = JBUI.Borders.emptyRight(gap)
        badges.border = JBUI.Borders.emptyLeft(gap)
        syncBadges(leading, if (hidden) emptyList() else item.leading, color)
        syncBadges(badges, if (hidden) emptyList() else item.badges, color)
        syncBadges(secondary, if (hidden) emptyList() else item.secondaryBadges, color)
    }

    private fun syncBadges(stack: JPanel, items: List<ActiveBadge>, color: Color) {
        while (stack.componentCount > items.size) stack.remove(stack.componentCount - 1)
        while (stack.componentCount < items.size) stack.add(ActiveBadgeCell())
        stack.isVisible = items.isNotEmpty()
        for (i in items.indices) {
            (stack.getComponent(i) as ActiveBadgeCell).update(items[i], color)
        }
    }

    private fun syncCells(item: ActiveItem, selected: Boolean) {
        val visible = activeVisibleCells(item, selected)
        while (cells.componentCount > visible.size) cells.remove(cells.componentCount - 1)
        while (cells.componentCount < visible.size) cells.add(ActiveActionCell())
        cells.isVisible = visible.isNotEmpty()
        for (i in visible.indices) {
            (cells.getComponent(i) as ActiveActionCell).update(visible[i])
        }
    }
}

internal class ActiveChangesCell @RequiresEdt constructor() : JPanel(BorderLayout()), ActiveHitCell {
    private val panel = ChangesPanel(ChangesPanel.Mode.COMPACT)
    private var data: ActiveMetrics? = null

    override val cellId = ACTIVE_CHANGES_CELL

    init {
        UiStyle.Components.transparent(this)
        add(panel, BorderLayout.CENTER)
    }

    @RequiresEdt
    fun update(data: ActiveMetrics?) {
        this.data = data
        panel.update(
            data?.files ?: 0,
            data?.additions ?: 0,
            data?.deletions ?: 0,
            localFiles = data?.localFiles ?: 0,
            localAdditions = data?.localAdditions ?: 0,
            localDeletions = data?.localDeletions ?: 0,
            base = data?.base.orEmpty(),
            conflict = data?.conflict == true,
        )
        panel.setActions(data?.action.takeIf { isEnabled })
        isVisible = panel.isVisible
        toolTipText = panel.toolTipText
    }

    @RequiresEdt
    override fun cellEnabled(): Boolean = isVisible && isEnabled && data?.action != null

    override fun cellCursor(): Int = Cursor.HAND_CURSOR

    @RequiresEdt
    override fun cellTooltip(): String? = toolTipText

    override fun cellAction(): (() -> Unit)? = data?.action
}

internal class ActiveActionCell : JBLabel(), ActiveHitCell {
    private var cell: ActiveCell? = null

    override var cellId: String = ""
        private set

    fun update(cell: ActiveCell) {
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

/** A retained badge pill or status glyph that opts into list hit-testing when its model carries an id. */
internal class ActiveBadgeCell : JBLabel(), ActiveHitCell {
    private var badge: ActiveBadge? = null

    override var cellId: String = ""
        private set

    /**
     * [color] is the row's text foreground, applied only to a labelled glyph. A pill paints its own text
     * inside [FilledBadgeIcon], and a bare glyph has no text to color; a labelled glyph does, and a
     * [JBLabel]'s own foreground is a UIResource that does not inherit from the transparent stack it sits
     * in, so a count would otherwise be unreadable on a selected row.
     */
    fun update(badge: ActiveBadge, color: Color? = null) {
        this.badge = badge
        cellId = badge.id.orEmpty()
        val next = badge.icon ?: pill(badge)
        // Both branches answer with the instance already installed when nothing changed, so a repaint
        // of an unchanged row does not churn the label's icon.
        if (icon !== next) icon = next
        val label = if (badge.icon != null) badge.text else ""
        if (text != label) text = label
        if (label.isNotBlank()) {
            // Font and gap match the ahead/behind counters in ChangesPanel: a glyph with a figure beside it
            // reads as one token, and a default label gap pulls the two apart into an icon with a caption.
            // Re-read rather than assigned once, because updateUI puts the LaF defaults back on an IDE
            // zoom; the comparisons make that the only time this writes.
            val small = JBFont.small()
            if (font != small) font = small
            val gap = UiStyle.Gap.xs()
            if (iconTextGap != gap) iconTextGap = gap
            if (color != null && foreground != color) foreground = color
        }
        toolTipText = cellTooltip()
    }

    private fun pill(badge: ActiveBadge): Icon {
        val current = icon as? FilledBadgeIcon
        val parts = badge.parts()
        if (current?.segments == parts) return current
        return FilledBadgeIcon(parts)
    }

    override fun cellEnabled(): Boolean = badge?.action != null

    override fun cellCursor(): Int = Cursor.HAND_CURSOR

    override fun cellTooltip(): String? = badge?.tooltip?.takeIf { it.isNotBlank() }

    override fun cellAction(): (() -> Unit)? = badge?.action
}

private fun ActiveIconAlignment.align(): VAlign = when (this) {
    ActiveIconAlignment.CENTER -> VAlign.CENTER
    ActiveIconAlignment.TOP -> VAlign.TOP
}

/**
 * Wrapping row body used when [ActiveConfig.wrapDescription] is enabled, in place of the
 * single-line faded [FadeText]. Non-interactive: it carries no [ActiveHitCell] contract, so it
 * never becomes a click/cursor/tooltip target the way a badge or action cell does.
 *
 * Measured at its own current width rather than a fixed row/columns count, matching the same
 * pattern as `MessageErrorView.ErrorText`: [javax.swing.JTextArea] answers a wrap-aware preferred
 * height only once it already knows the width it will paint at, so [getPreferredSize] re-measures
 * against [width] instead of the platform default.
 */
private class ActiveWrapText : JBTextArea() {
    init {
        isEditable = false
        isFocusable = false
        caret.isVisible = false
        caret.isSelectionVisible = false
        lineWrap = true
        wrapStyleWord = true
        border = JBUI.Borders.empty()
    }

    override fun getPreferredSize(): Dimension {
        if (width <= 0) return super.getPreferredSize()
        val old = size
        setSize(width, Int.MAX_VALUE)
        val height = super.getPreferredSize().height
        setSize(old)
        return Dimension(width, height)
    }
}
