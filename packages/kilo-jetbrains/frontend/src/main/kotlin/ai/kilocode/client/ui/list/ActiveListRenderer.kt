package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.active.ActiveConfig
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.active.ActiveMenu
import ai.kilocode.client.ui.active.ActiveRenderState
import ai.kilocode.client.ui.active.ActiveRenderer
import ai.kilocode.client.ui.active.ActiveWeight
import ai.kilocode.client.ui.active.activeLayout
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.RelativeFont
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBInsets
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BasicStroke
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Image
import java.awt.Point
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer

/**
 * List adapter around the container-neutral [ActiveRenderer]. It owns the list-only section band,
 * equal-height handling and the dashed drag placeholder; the row body itself is the same component
 * the worktree tree renders.
 */
internal class ActiveListRenderer(
    private val model: CollectionListModel<ActiveItem>,
    private val cfg: ActiveConfig = ActiveConfig.Equal,
    private val menu: ActiveMenu<*>? = null,
    private val options: ActiveListOptions = ActiveListOptions(),
) : JPanel(BorderLayout()), ListCellRenderer<ActiveItem> {
    private val insets = JBUI.CurrentTheme.Popup.separatorLabelInsets()
    private val sep = GroupHeaderSeparator(insets)
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    private val body = ActiveRenderer(cfg, menu)
    private var section: String? = null
    private var gap = false
    private var bodyHeight: Int? = null

    init {
        isOpaque = true
        top.isOpaque = true
        add(top, BorderLayout.NORTH)
        add(body, BorderLayout.CENTER)
    }

    private fun activeFade() = Registry.`is`("kilo.list.fade", true)

    override fun updateUI() {
        super.updateUI()
        (insets as? JBInsets)?.update()
    }

    @RequiresEdt
    override fun getListCellRendererComponent(
        list: JList<out ActiveItem>,
        value: ActiveItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val active = selected && (focused || list.hasFocus() || (list as? ActiveListActive)?.active() == true)
        val fg = UIUtil.getListForeground(active, active || focused)
        val sectionTitle = activeListSectionTitle(model.items, index)

        background = list.background
        top.background = list.background
        syncHeader(sectionTitle, index)

        if (value is ActiveGap) {
            gap = true
            body.isVisible = true
            body.body().isVisible = false
            body.preferredSize = Dimension(0, bodyHeight ?: value.height)
            body.setBounds(0, 0, list.width.coerceAtLeast(1), bodyHeight ?: value.height)
            return this
        }
        gap = false
        body.body().isVisible = true
        val hovered = (list as? ActiveListActive)?.hoveredIndex() == index
        val show = when {
            cfg.hoverActions -> list.isEnabled && selected && hovered
            cfg.keepActions -> selected && list.isEnabled
            else -> active && list.isEnabled
        }
        val selection = UIUtil.getListBackground(true, active)
        body.render(
            ActiveRenderState(
                item = value,
                selected = selected,
                focused = focused,
                active = active,
                hovered = hovered,
                enabled = list.isEnabled,
                background = list.background,
                selectionColor = if (selected) selection else null,
                paintSelection = true,
                backdrop = if (selected && activeFade()) selection else list.background,
                foreground = fg,
                pillBackground = if (selected && list.isEnabled) selection else list.background,
                width = list.width,
                actionsVisible = show,
                menuVisible = list.isEnabled && hovered && menu?.available(value) == true,
                opaque = true,
                bodyHeight = bodyHeight,
            ),
        )
        return this
    }

    private fun syncHeader(section: String?, index: Int) {
        this.section = section
        sep.caption = section
        sep.setHideLine(!options.divider || index == 0)
        val font = if (options.header == ActiveWeight.BOLD) {
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
        ai.kilocode.client.ui.active.activePlaceholder(g, body.bounds)
    }

    fun setBodyHeight(height: Int?) {
        if (bodyHeight == height) return
        bodyHeight = height
    }

    fun bodyPreferredHeight(
        list: JList<out ActiveItem>,
        value: ActiveItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): Int {
        val state = state(list, value, index, selected, focused)
        val fixed = bodyHeight
        bodyHeight = null
        body.setBodyHeight(null)
        val height = body.bodyPreferredHeight(state)
        bodyHeight = fixed
        body.setBodyHeight(fixed)
        return height
    }

    /** Paints the list row body into an image for drag-and-drop. */
    fun rowImage(
        list: JList<out ActiveItem>,
        value: ActiveItem,
        index: Int,
        width: Int,
    ): Pair<BufferedImage, Point>? {
        getListCellRendererComponent(list, value, index, true, true)
        val band = if (top.isVisible) top.preferredSize.height else 0
        val state = state(list, value, index, true, true)
        body.setBodyHeight(bodyHeight)
        val image = body.rowImage(state, width) ?: return null
        return image.first to Point(image.second.x.coerceAtLeast(0), image.second.y.coerceAtLeast(0) + band)
    }

    private fun state(
        list: JList<out ActiveItem>,
        value: ActiveItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): ActiveRenderState {
        val active = selected && (focused || list.hasFocus() || (list as? ActiveListActive)?.active() == true)
        val fg = UIUtil.getListForeground(active, active || focused)
        val selection = UIUtil.getListBackground(true, active)
        val hovered = (list as? ActiveListActive)?.hoveredIndex() == index
        val show = when {
            cfg.hoverActions -> list.isEnabled && selected && hovered
            cfg.keepActions -> selected && list.isEnabled
            else -> active && list.isEnabled
        }
        return ActiveRenderState(
            item = value,
            selected = selected,
            focused = focused,
            active = active,
            hovered = hovered,
            enabled = list.isEnabled,
            background = list.background,
            selectionColor = if (selected) selection else null,
            paintSelection = true,
            backdrop = if (selected && activeFade()) selection else list.background,
            foreground = fg,
            pillBackground = if (selected && list.isEnabled) selection else list.background,
            width = list.width,
            actionsVisible = show,
            menuVisible = list.isEnabled && hovered && menu?.available(value) == true,
            opaque = true,
        )
    }
}

internal interface ActiveListActive {
    fun active(): Boolean

    fun hoveredIndex(): Int = -1
}
