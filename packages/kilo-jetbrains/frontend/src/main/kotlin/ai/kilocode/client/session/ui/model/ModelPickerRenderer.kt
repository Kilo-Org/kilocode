package ai.kilocode.client.session.ui.model

import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.NewUI
import com.intellij.ui.JBColor
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.Point
import java.awt.Rectangle
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
        val DATA_COLLECTED: Icon = IconLoader.getIcon("/icons/book-open-check.svg", ModelPickerRenderer::class.java)
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
            if (!NewUI.isEnabled()) return 0
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
    private val badge = FilledBadgeIcon(
        ModelText.freeLabel(),
        ModelText.freeBg(),
        JBColor.namedColor("Kilo.ModelPicker.freeBadgeForeground", JBColor.WHITE),
    )
    private val badgeLabel = BadgeLabel(badge).apply {
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
    }
    private val byok = FilledBadgeIcon(
        "BYOK",
        UiStyle.Colors.badgeBg(),
        UiStyle.Colors.badgeFg(),
    )
    private val byokLabel = BadgeLabel(byok).apply {
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
    }
    private val warn = JBLabel(DATA_COLLECTED).apply {
        toolTipText = ModelText.dataCollected()
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
    }
    private val provider = JBLabel()
    private val head = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
        add(title)
        add(warn)
        add(badgeLabel)
        add(byokLabel)
        add(provider)
    }
    private val star = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
    }
    private val row = JPanel(BorderLayout()).apply {
        add(check, BorderLayout.WEST)
        add(head, BorderLayout.CENTER)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, check, title, head, warn, provider, star)
        row.border = JBUI.Borders.empty(
            UiStyle.Gap.md(),
            UiStyle.Gap.lg(),
            UiStyle.Gap.md(),
            UiStyle.Gap.pad(),
        )
        wrap.setContent(row, star)
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

        check.icon = if (value.key == active()) checked else empty
        title.clear()
        val item = value.item
        if (item == null) {
            title.append(value.emptyText, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))
            badgeLabel.isVisible = false
            byokLabel.isVisible = false
            warn.isVisible = false
            provider.isVisible = false
            star.icon = EmptyIcon.ICON_16
            top.invalidate()
            return this
        }
        val name = ModelText.parts(item)
        if (name.provider != null) {
            title.append(name.provider, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
            title.append(" ", SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
        }
        title.append(name.model, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))

        warn.isVisible = ModelText.collectsData(item)
        badgeLabel.isVisible = item.free && !item.byok
        byokLabel.isVisible = item.byok
        provider.isVisible = value.favorite
        provider.text = item.providerName
        provider.foreground = weak
        provider.border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())

        val fav = item.key in favorites()
        star.icon = when {
            fav -> AllIcons.Nodes.Favorite
            selected -> AllIcons.Nodes.NotFavoriteOnHover
            else -> EmptyIcon.ICON_16
        }

        top.invalidate()

        return this
    }

    internal fun starIcon(): Icon? = star.icon

    internal fun badgeVisible(): Boolean = badgeLabel.isVisible

    internal fun badgeText(): String = badge.text

    internal fun byokVisible(): Boolean = byokLabel.isVisible

    internal fun warningVisible(): Boolean = warn.isVisible

    internal fun warningTooltip(): String? = warn.toolTipText

    private class BadgeLabel(icon: Icon) : JBLabel(icon)
}
