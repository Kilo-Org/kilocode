package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionButtonComponent
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.ex.CustomComponentAction
import com.intellij.openapi.actionSystem.ex.ActionButtonLook
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.ActionUiKind
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
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.RelativeFont
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.IconUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBInsets
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.AlphaComposite
import java.awt.BasicStroke
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.RenderingHints
import java.awt.Rectangle
import java.awt.image.BufferedImage
import com.intellij.ui.components.JBTextArea
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

/**
 * Unscaled gap around a row's badge columns.
 *
 * Read from the same theme key as [JBUI.CurrentTheme.ActionsList.elementIconGap] but left unscaled, so
 * one value can feed both the layout gaps (which need pixels) and [JBUI.Borders] (which scales what it
 * is handed).
 */
private fun activeListIconGap() = JBUI.getInt("ActionsList.icon.gap", UiStyle.Gap.MD)

/**
 * Whether row text that does not fit fades into the row background instead of stopping at a bare cut.
 *
 * On by default. Off leaves the cut exposed, which is legible but reads as the end of the text rather than
 * the middle of it — the escape hatch for a surface where the fade is wrong, such as a theme that paints a
 * row background the renderer cannot name.
 */
private fun activeListFade() = Registry.`is`("kilo.list.fade", true)

internal class ActiveListRenderer(
    private val model: CollectionListModel<ActiveListItem>,
    private val cfg: ActiveListConfig = ActiveListConfig.Equal,
    private val toggles: (String) -> (() -> Unit)? = { null },
    private val folding: Boolean = false,
) : JPanel(BorderLayout()), ListCellRenderer<ActiveListItem> {
    /**
     * A list with a row menu. [toggles] is only consulted by a [collapse] list; a list that never
     * folds keeps [ActiveListConfig] and the cell tree it has always had.
     */
    constructor(
        model: CollectionListModel<ActiveListItem>,
        cfg: ActiveListConfig = ActiveListConfig.Equal,
        menu: ActiveListMenu<*>?,
        collapse: Boolean = false,
        toggles: (String) -> (() -> Unit)? = { null },
        sections: ActiveListCollapse? = null,
    ) : this(model, cfg, toggles, collapse) {
        this.sections = sections
        this.menu = menu
        if (menu != null) attachMenu(menu)
    }

    private fun attachMenu(menu: ActiveListMenu<*>) {
        glyph.update(activeListMenuCell())
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
        // The menu column changes the row's own padding, so re-derive the scaled geometry now that
        // [menu] is known.
        syncScale()
    }

    private var menu: ActiveListMenu<*>? = null
    private var sections: ActiveListCollapse? = null
    private val insets = JBUI.CurrentTheme.Popup.separatorLabelInsets().let {
        JBUI.insets(it.top + UiStyle.Gap.sm(), it.left, it.bottom, it.right)
    }
    private val sep = GroupHeaderSeparator(insets)
    /** Trailing indicator; the containing band owns the click target. */
    private val chevron = ActiveListActionCell()
    private val toggle = SectionToggle(chevron)
    private val toolbar = Stack.horizontal()

    // Only a list that can fold gets this container; every other list keeps the platform separator
    // directly in the cell header, exactly as before.
    private val band: JPanel? = if (folding) {
        BandPanel(toggle).apply {
            add(toggle)
            add(sep)
            add(toolbar)
        }
    } else {
        null
    }
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(band ?: sep, BorderLayout.NORTH)
    }
    // Pin the glyph to the top of the label so a stretched icon column keeps the icon on the
    // first text line instead of centering it across a multi-line row.
    private val icon = JBLabel().apply { verticalAlignment = SwingConstants.TOP }
    private val mark = icon.align(HAlign.CENTER, cfg.iconAlignment.align())
    private val title = FadeText()
    private val leading = Stack.horizontal(JBUI.scale(activeListIconGap()))
    private val badges = Stack.horizontal(JBUI.scale(activeListIconGap()))
    private val secondary = Stack.horizontal(UiStyle.Gap.md())
    // Title in CENTER clips when the group is narrow; tags in WEST/EAST keep their full preferred
    // width. A squeezed row sacrifices the title text but never drops the tags.
    private val titleGroup = JPanel(BorderLayout(UiStyle.Gap.xs(), 0)).apply {
        add(leading, BorderLayout.WEST)
        add(title, BorderLayout.CENTER)
        add(badges, BorderLayout.EAST)
    }
    // Pin the title+badges group to the leading edge so badges trail the title text directly instead of
    // drifting to the far right of the row. A list that opts into [ActiveListConfig.badgesRight] gets
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
    private val descWrap: ActiveListWrapText? = if (cfg.wrapDescription) ActiveListWrapText() else null
    private val descBody: JComponent = descWrap ?: desc
    private val metrics = ActiveListChangesCell()
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
    private val cells = Stack.horizontal(activeListCellGap())
    private val cellPane = cells.align(HAlign.RIGHT, VAlign.CENTER)
    private val pill = JPanel(BorderLayout()).apply {
        add(cellPane, BorderLayout.CENTER)
    }
    // The dropdown button keeps the overlay approach: a real empty-icon [spacer] holds the trailing
    // column in the row layout, and the [glyph] button floats over that slot — revealed on hover —
    // so the row body is laid out beside the column and never shifts. Both are bare (no border) so
    // the icon sits flush against the content edge, mirroring the flush leading icon.
    private val glyph = ActiveListActionCell()
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
    private var gap = false
    // JPanel's constructor calls updateUI() before any field below exists, so guard the refresh.
    private var wired = false

    init {
        isOpaque = true
        top.isOpaque = true
        chevron.isVisible = false
        band?.let { UiStyle.Components.transparent(it) }
        UiStyle.Components.transparent(
            layers,
            layers.content,
            row,
            chevron,
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
        add(top, BorderLayout.NORTH)
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
        // Shared with [sep], which holds this exact instance, so one update covers the header band too.
        (insets as? JBInsets)?.update()
        // [sep]'s own font is left alone on purpose: GroupHeaderSeparator builds it from JBFont, and a
        // JBFont re-derives its size from "Label.font" on read, so it already follows an IDE zoom.
        val iconGap = JBUI.scale(activeListIconGap())
        leading.space = iconGap
        badges.space = iconGap
        secondary.space = UiStyle.Gap.md()
        details.space = UiStyle.Gap.md()
        cells.space = activeListCellGap()
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
        // Collapsible bands keep padding inside their full-width hit target. Plain separators use the
        // header border so every ActiveList section gets the same vertical breathing room.
        top.border = if (folding) JBUI.Borders.empty() else JBUI.Borders.empty(UiStyle.Gap.SM, 0)
        toolbar.border = JBUI.Borders.empty(UiStyle.Gap.SM, 0)
        band?.border = JBUI.Borders.empty()
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
        // The band belongs to the row that opens a section — the previous row has a different one — and
        // to a folded section's stand-in. Reading it off the stamped row keeps the on-demand hit stamp,
        // which is built from the bare renderer without the platform's leading-line reset, honest.
        val prev = model.items.getOrNull(index - 1)
        val heading = value.section?.takeIf { it != prev?.section }
        val folded = value is ActiveListSectionRow

        background = list.background
        top.background = list.background
        wrap.update(list, selected, active)
        syncHeader(heading, index, folded, value.section?.let(toggles))

        if (value is ActiveListGap) {
            gap = true
            layers.isVisible = false
            pill.isVisible = false
            glyph.isVisible = false
            wrap.update(list, false, false)
            wrap.setPreferredSize(Dimension(0, bodyHeight ?: value.height))
            syncHover(list, index)
            activeListInvalidate(this)
            return this
        }
        if (value is ActiveListSectionRow) {
            // A collapsed section's stand-in: the band is the whole row. The body stays hidden rather
            // than sized to zero, so the cell measures its band and nothing else.
            gap = false
            layers.isVisible = false
            pill.isVisible = false
            glyph.isVisible = false
            wrap.isVisible = false
            syncHover(list, index)
            activeListInvalidate(this)
            return this
        }
        gap = false
        layers.isVisible = true
        wrap.isVisible = true

        // Text that runs out of room is cut and faded rather than ellipsed, so the row spends every pixel
        // it has on the text itself. The fade blends into whatever the row painted behind the line, read
        // back off [wrap] so it cannot drift from the selection color the row actually filled.
        val backdrop = if (activeListFade()) wrap.selectionColor ?: wrap.background else null
        title.backdrop = backdrop
        desc.backdrop = backdrop

        title.clear()
        // Bold carries most rows by default: the description under it and the icon beside it both
        // render in the muted secondary color, so cfg.title separates the two lines when enabled.
        val style = if (cfg.title == ActiveListWeight.BOLD) SimpleTextAttributes.STYLE_BOLD else SimpleTextAttributes.STYLE_PLAIN
        title.append(value.title, SimpleTextAttributes(style, titleFg))
        value.note?.takeIf { it.isNotBlank() }?.let {
            title.append("  $it", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
        // The row's ordinary text color rather than the muted one: a labelled glyph is a figure the user is
        // meant to read, and the muted tone made it fainter than the neutral glyph beside it. Selection
        // aware, so a highlighted row does not leave the count dark on dark blue.
        syncBadges(value, fg)
        // A selected row paints its title in the selection foreground; recolor a tinted glyph to
        // match so it reads as part of the highlighted text. Colored status icons opt out and keep
        // their own hue.
        icon.icon = value.icon?.let { if (active && value.tinted) IconUtil.colorize(it, fg, keepBrightness = false) else it }
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
        metrics.isEnabled = list.isEnabled && !value.disabled
        metrics.update(data)
        val end = value.progress ?: value.trailing.orEmpty()
        trail.text = end
        trail.isVisible = end.isNotBlank() && data == null
        detailsPane.isVisible = metrics.isVisible || secondary.isVisible
        descLine.isVisible = descBody.isVisible || detailsPane.isVisible
        trail.foreground = weak

        val hovered = (list as? ActiveListActive)?.hoveredIndex() == index
        val show = when {
            cfg.hoverActions -> list.isEnabled && selected && hovered
            cfg.keepActions -> selected && list.isEnabled
            else -> active && list.isEnabled
        }
        syncCells(value, show)
        cellPane.isVisible = cells.isVisible
        pill.isVisible = cells.isVisible
        menu?.let { glyph.isVisible = list.isEnabled && hovered && it.available(value) }
        // Match the row's own background so the pill never paints a focused-selection highlight
        // on a row that is not the focused selection (e.g. a hovered, unselected row).
        pill.background = if (selected && list.isEnabled) UIUtil.getListBackground(true, active) else list.background
        val height = bodyHeight
        wrap.setPreferredSize(height?.let { Dimension(0, it) })
        if (cfg.wrapDescription) {
            // [descWrap] answers its own preferred height from its current width (see
            // [ActiveListWrapText.getPreferredSize]), but nothing has assigned it a width yet: this
            // renderer is a stamp that has never been through a real layout pass at [list]'s size. A
            // real (not preferred-size-only) layout pass at the list's width — the same
            // [activeListLayout] helper [rowImage] uses to learn actual widths — cascades the real
            // column width down through every BorderLayout/Stack/Align level to [descWrap] before
            // anything below reads a preferred size. Column widths never depend on the height passed
            // here, so it is kept at a minimal placeholder rather than a generous one: [layers]'
            // absolutely-positioned overlay/blocker children have no layout manager of their own, so
            // in a renderer that was never added to a real, displayable window they fall back to
            // reporting their *current bounds* as their preferred size. A tall placeholder here would
            // land in that fallback and make [LayeredOverlayPanel] report a body far taller than the
            // wrapped text actually needs.
            setBounds(0, 0, list.width.coerceAtLeast(1), 1)
            activeListLayout(this)
        }
        // Neither the content mutations above nor setPreferredSize invalidate reliably: a same-size
        // icon swap, an equal label text, or an explicit preferred size leave the tree valid, and a
        // valid subtree keeps the sizes it was measured with for another row.
        syncHover(list, index)
        activeListInvalidate(this)
        return this
    }

    private fun syncHover(list: JList<out ActiveListItem>, index: Int) {
        val state = list as? ActiveListActive
        val id = state?.hoveredCell().takeIf { state?.hoveredIndex() == index }
        activeListApplyHover(this, id)
    }

    private fun syncHeader(heading: String?, index: Int, folded: Boolean, collapse: (() -> Unit)?) {
        sep.caption = heading
        sep.setHideLine(!cfg.divider || index == 0)
        val font = if (cfg.header == ActiveListWeight.BOLD) {
            RelativeFont.BOLD.derive(sep.font)
        } else {
            RelativeFont.PLAIN.derive(sep.font)
        }
        if (sep.font != font) sep.font = font
        // The band — and the chevron that rides on it — exists only on the row that opens a section.
        band?.isVisible = heading != null
        chevron.isVisible = folding && heading != null
        val actions = heading?.let { sections?.actions?.invoke(it) }.orEmpty()
        while (toolbar.componentCount > actions.size) toolbar.remove(toolbar.componentCount - 1)
        for ((idx, action) in actions.withIndex()) {
            val cell = toolbar.components.getOrNull(idx) as? SectionAction
            if (cell?.action !== action) {
                if (cell != null) toolbar.remove(idx)
                toolbar.add(SectionAction(action) { sections?.context?.invoke() ?: DataContext.EMPTY_CONTEXT }, idx)
            }
            (toolbar.getComponent(idx) as SectionAction).update()
        }
        toolbar.isVisible = actions.isNotEmpty()
        // A folded section's caption already carries its hidden-row count and names the section it
        // stands for; every other band returns there through the owner's stable action.
        if (folded) {
            chevron.update(
                ActiveListCell(
                    "",
                    KiloBundle.message("list.section.expand"),
                    icon = AllIcons.General.ArrowRight,
                    iconOnly = true,
                    alwaysVisible = true,
                    action = collapse,
                ),
            )
        } else if (collapse != null) {
            chevron.update(
                ActiveListCell(
                    "",
                    KiloBundle.message("list.section.collapse"),
                    icon = AllIcons.General.ArrowDown,
                    iconOnly = true,
                    alwaysVisible = true,
                    action = collapse,
                ),
            )
        }
        top.isVisible = heading != null
        top.setPreferredSize(heading?.let {
            val height = sep.preferredSize.height
                .coerceAtLeast(sep.getFontMetrics(sep.font).height + insets.top + insets.bottom)
                .coerceAtLeast(toolbar.preferredSize.height + insets.top + insets.bottom)
            val padding = if (folding) UiStyle.Gap.sm() * 2 else top.insets.top + top.insets.bottom
            Dimension(0, height + padding + JBUI.scale(2))
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
        if (value is ActiveListSectionRow) return 0
        bodyHeight = null
        getListCellRendererComponent(list, value, index, selected, focused)
        val height = LayoutPass.measure { wrap.preferredSize.height }
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

    private fun syncBadges(item: ActiveListItem, color: Color) {
        val hidden = item.progress != null
        val gap = activeListIconGap()
        leading.border = JBUI.Borders.emptyRight(gap)
        badges.border = JBUI.Borders.emptyLeft(gap)
        syncBadges(leading, if (hidden) emptyList() else item.leading, color)
        syncBadges(badges, if (hidden) emptyList() else item.badges, color)
        syncBadges(secondary, if (hidden) emptyList() else item.secondaryBadges, color)
    }

    private fun syncBadges(stack: JPanel, items: List<ActiveListBadge>, color: Color) {
        while (stack.componentCount > items.size) stack.remove(stack.componentCount - 1)
        while (stack.componentCount < items.size) stack.add(ActiveListBadgeCell())
        stack.isVisible = items.isNotEmpty()
        for (i in items.indices) {
            (stack.getComponent(i) as ActiveListBadgeCell).update(items[i], color)
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

    fun hoveredCell(): String? = null
}

internal class ActiveListChangesCell @RequiresEdt constructor() : JPanel(BorderLayout()), ActiveListHitCell {
    private val panel = ChangesPanel(ChangesPanel.Mode.COMPACT)
    private var data: ActiveListMetrics? = null

    override val cellId = ACTIVE_LIST_CHANGES_CELL

    init {
        UiStyle.Components.transparent(this)
        add(panel, BorderLayout.CENTER)
    }

    @RequiresEdt
    fun update(data: ActiveListMetrics?) {
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

/** Full-width toggle target, with toolbar buttons immediately before the trailing indicator. */
private class BandPanel(private val toggle: SectionToggle) : JPanel(null), ActiveListHitCell {
    override val cellId: String get() = ACTIVE_LIST_SECTION_CELL
    override fun cellEnabled() = toggle.cellEnabled()
    override fun cellCursor() = toggle.cellCursor()
    override fun cellTooltip() = toggle.cellTooltip()
    override fun cellAction() = toggle.cellAction()

    override fun getPreferredSize(): Dimension = Dimension(
        components.filter { it.isVisible }.sumOf { it.preferredSize.width },
        (components.filter { it.isVisible }.maxOfOrNull { it.preferredSize.height } ?: 0) + UiStyle.Gap.sm() * 2,
    )

    override fun doLayout() {
        val sep = components.getOrNull(1) ?: return
        val padding = UiStyle.Gap.sm()
        val content = (height - padding * 2).coerceAtLeast(0)
        sep.setBounds(0, padding, width, content)
        val size = toggle.preferredSize
        val insets = JBUI.CurrentTheme.Popup.separatorLabelInsets()
        val bottom = this.height - padding - insets.bottom
        toggle.setBounds(
            (width - size.width).coerceAtLeast(0),
            (bottom - size.height).coerceAtLeast(0),
            size.width,
            size.height,
        )
        val toolbar = components.getOrNull(2) as? Container ?: return
        val space = (toggle.x - UiStyle.Gap.sm()).coerceAtLeast(0)
        val width = toolbar.preferredSize.width.coerceAtMost(space)
        val height = toolbar.preferredSize.height.coerceAtMost(this.height)
        // The toolbar's small top/bottom border surrounds its actions; position that outer box around
        // the toggle so the actual buttons inside it share the toggle's vertical bounds.
        val top = (toggle.y - toolbar.insets.top).coerceAtLeast(0)
        toolbar.setBounds(space - width, top, width, height.coerceAtMost(this.height - top))
    }
}

/** Trailing expand/collapse control; the tooltip remains, but it intentionally has no hover chrome. */
private class SectionToggle(private val chevron: ActiveListActionCell) : JPanel(BorderLayout()), ActiveListHitCell {
    override val cellId = ACTIVE_LIST_SECTION_TOGGLE_CELL

    init {
        UiStyle.Components.transparent(this)
        add(chevron, BorderLayout.CENTER)
    }

    override fun getPreferredSize(): Dimension = ActionToolbar.DEFAULT_MINIMUM_BUTTON_SIZE

    override fun cellEnabled() = chevron.cellEnabled()
    override fun cellCursor() = chevron.cellCursor()
    override fun cellTooltip() = chevron.cellTooltip()
    override fun cellAction() = chevron.cellAction()
}

/** Renderer buttons expose their platform presentation through the list's synthetic click path. */
private class SectionAction @RequiresEdt constructor(
    val action: AnAction,
    private val context: () -> DataContext,
) : JPanel(BorderLayout()), ActiveListHitCell, ActiveListHoverCell {
    private var hovered = false
    private val presentation = action.templatePresentation.clone()
    private val button = (action as? CustomComponentAction)?.createCustomComponent(presentation, ActionPlaces.TOOLWINDOW_TITLE)
        ?: ActionButton(action, presentation, ActionPlaces.TOOLWINDOW_TITLE, ActionToolbar.DEFAULT_MINIMUM_BUTTON_SIZE)
    override val cellId = "$ACTIVE_LIST_SECTION_CELL:action:${System.identityHashCode(action)}"

    init {
        UiStyle.Components.transparent(this)
        add(button, BorderLayout.CENTER)
    }

    private fun event() = AnActionEvent.createEvent(context(), presentation, ActionPlaces.TOOLWINDOW_TITLE, ActionUiKind.TOOLBAR, null)

    @RequiresEdt
    fun update() {
        action.update(event())
        isVisible = presentation.isVisible
        button.isEnabled = presentation.isEnabled
    }

    override fun cellEnabled() = presentation.isEnabled && presentation.isVisible
    override fun cellCursor() = Cursor.HAND_CURSOR
    override fun cellTooltip() = presentation.description ?: presentation.text
    override fun cellAction(): () -> Unit = { action.actionPerformed(event()) }

    override fun cellHovered(hovered: Boolean) {
        this.hovered = hovered
    }

    override fun paintComponent(g: Graphics) {
        if (hovered && cellEnabled()) {
            ActionButtonLook.SYSTEM_LOOK.paintBackground(g, button, ActionButtonComponent.POPPED)
            ActionButtonLook.SYSTEM_LOOK.paintBorder(g, button, ActionButtonComponent.POPPED)
        }
        super.paintComponent(g)
    }
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

/** A retained badge pill or status glyph that opts into list hit-testing when its model carries an id. */
internal class ActiveListBadgeCell : JBLabel(), ActiveListHitCell {
    private var badge: ActiveListBadge? = null

    override var cellId: String = ""
        private set

    /**
     * [color] is the row's text foreground, applied only to a labelled glyph. A pill paints its own text
     * inside [FilledBadgeIcon], and a bare glyph has no text to color; a labelled glyph does, and a
     * [JBLabel]'s own foreground is a UIResource that does not inherit from the transparent stack it sits
     * in, so a count would otherwise be unreadable on a selected row.
     */
    fun update(badge: ActiveListBadge, color: Color? = null) {
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

    private fun pill(badge: ActiveListBadge): Icon {
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

private fun ActiveListIconAlignment.align(): VAlign = when (this) {
    ActiveListIconAlignment.CENTER -> VAlign.CENTER
    ActiveListIconAlignment.TOP -> VAlign.TOP
}

/**
 * Wrapping row body used when [ActiveListConfig.wrapDescription] is enabled, in place of the
 * single-line faded [FadeText]. Non-interactive: it carries no [ActiveListHitCell] contract, so it
 * never becomes a click/cursor/tooltip target the way a badge or action cell does.
 *
 * Measured at its own current width rather than a fixed row/columns count, matching the same
 * pattern as `MessageErrorView.ErrorText`: [javax.swing.JTextArea] answers a wrap-aware preferred
 * height only once it already knows the width it will paint at, so [getPreferredSize] re-measures
 * against [width] instead of the platform default.
 */
private class ActiveListWrapText : JBTextArea() {
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
