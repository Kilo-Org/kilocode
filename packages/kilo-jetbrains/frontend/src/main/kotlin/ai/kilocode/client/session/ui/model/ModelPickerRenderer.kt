package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ExperimentalUI
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.JBColor
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.Toolkit
import javax.swing.Icon
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

private const val FAVORITE_CLICK_AREA_WIDTH = 32

internal class ModelPickerRenderer(
    private val model: CollectionListModel<ModelPickerRow>,
    private val active: () -> String?,
    private val favorites: () -> Set<String>,
) : JPanel(BorderLayout()), ListCellRenderer<ModelPickerRow> {
    companion object {
        val checked: Icon = AllIcons.Actions.Checked
        val empty: Icon = EmptyIcon.create(checked)

        fun isFavoriteClick(list: JList<*>, bounds: Rectangle, point: Point): Boolean {
            val width = JBUI.scale(FAVORITE_CLICK_AREA_WIDTH)
            val inset = favoriteInset(list)
            if (list.componentOrientation.isLeftToRight) {
                val right = bounds.x + bounds.width - inset
                return point.x in (right - width)..right
            }
            val left = bounds.x + inset
            return point.x in left..(left + width)
        }

        private fun favoriteInset(list: JList<*>): Int {
            if (!ExperimentalUI.isNewUI()) return 0
            val inner = JBUI.CurrentTheme.Popup.Selection.innerInsets()
            val edge = JBUI.CurrentTheme.Popup.Selection.LEFT_RIGHT_INSET.get()
            return edge + if (list.componentOrientation.isLeftToRight) inner.right else inner.left
        }
    }

    private val sep = GroupHeaderSeparator(JBUI.CurrentTheme.Popup.separatorLabelInsets())
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    private val check = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
    }
    private val title = SimpleColoredComponent()
    private val badge = BadgeIcon
    private val provider = JBLabel()
    private val head = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
        add(title)
        add(BadgeLabel(badge).apply {
            border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
        })
        add(provider)
    }
    private val star = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
    }
    private val row = JPanel(BorderLayout()).apply {
        add(check, BorderLayout.WEST)
        add(head, BorderLayout.CENTER)
        add(star, BorderLayout.EAST)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, check, title, head, provider, star)
        row.border = JBUI.Borders.empty(
            UiStyle.Gap.md(),
            UiStyle.Gap.lg(),
            UiStyle.Gap.md(),
            UiStyle.Gap.pad(),
        )
        wrap.setContent(row)
        add(top, BorderLayout.NORTH)
        add(wrap, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out ModelPickerRow>,
        value: ModelPickerRow,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val focus = selected || list.hasFocus() || focused
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UiStyle.Colors.weak()
        val current = model.items.getOrNull(index)
        val section = if (current === value) modelPickerSectionTitle(model.items, index) else null

        background = list.background
        top.background = list.background
        wrap.update(list, selected, focus)
        sep.caption = section
        sep.setHideLine(index == 0)
        top.isVisible = section != null

        check.icon = if (value.item.key == active()) checked else empty
        title.clear()
        val name = ModelText.parts(value.item)
        if (name.provider != null) {
            title.append(name.provider, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
            title.append(" ", SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
        }
        title.append(name.model, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))

        head.getComponent(1).isVisible = value.item.free
        provider.isVisible = value.favorite
        provider.text = value.item.providerName
        provider.foreground = weak
        provider.border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())

        val fav = value.item.key in favorites()
        star.icon = when {
            fav -> AllIcons.Nodes.Favorite
            selected -> AllIcons.Nodes.NotFavoriteOnHover
            else -> EmptyIcon.ICON_16
        }

        top.invalidate()

        return this
    }

    internal fun starIcon(): Icon? = star.icon

    internal fun badgeVisible(): Boolean = head.getComponent(1).isVisible

    private class BadgeLabel(icon: Icon) : JBLabel(icon)

    private object BadgeIcon : Icon {
        private val text = KiloBundle.message("model.picker.free")

        override fun getIconWidth(): Int {
            val fm = JBFont.small().let { font ->
                @Suppress("DEPRECATION")
                Toolkit.getDefaultToolkit().getFontMetrics(font)
            }
            return fm.stringWidth(text) + JBUI.scale(12)
        }

        override fun getIconHeight(): Int = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                g2.color = ModelText.freeBg()
                g2.fillRoundRect(0, 0, iconWidth, iconHeight, JBUI.scale(4), JBUI.scale(4))
                g2.color = JBColor.namedColor("Kilo.ModelPicker.freeBadgeForeground", JBColor.WHITE)
                g2.font = JBFont.small()
                val fm = g2.fontMetrics
                val y = (iconHeight + fm.ascent - fm.descent) / 2
                g2.drawString(text, JBUI.scale(6), y)
            } finally {
                g2.dispose()
            }
        }
    }
}
