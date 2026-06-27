package ai.kilocode.client.settings.base

import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

internal class SettingsListRenderer(
    private val model: CollectionListModel<SettingsListItem>,
) : JPanel(BorderLayout()), ListCellRenderer<SettingsListItem> {
    private val sep = GroupHeaderSeparator(JBUI.CurrentTheme.Popup.separatorLabelInsets())
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    private val icon = JBLabel()
    private val mark = icon.align(HAlign.CENTER, VAlign.TOP)
    private val title = SimpleColoredComponent()
    private val badges = Stack.horizontal()
    private val head = Stack.horizontal(UiStyle.Gap.xs()).next(title).next(badges)
    private val desc = JBLabel()
    private val text = Stack.vertical().next(head).next(desc)
    private val cells = Stack.horizontal(settingsListCellGap())
    private val cellPane = cells.align(HAlign.RIGHT, VAlign.CENTER)
    private val row = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(mark, BorderLayout.WEST)
        add(text, BorderLayout.CENTER)
        add(cellPane, BorderLayout.EAST)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, mark, icon, title, badges, head, text, desc, cells, cellPane)
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
        list: JList<out SettingsListItem>,
        value: SettingsListItem,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val focus = selected || list.hasFocus() || focused
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UiStyle.Colors.weak()
        val current = model.items.getOrNull(index)
        val section = if (current === value) settingsListSectionTitle(model.items, index) else null

        background = list.background
        top.background = list.background
        wrap.update(list, selected, focus)
        sep.caption = section
        sep.setHideLine(index == 0)
        top.isVisible = section != null

        title.clear()
        title.append(value.title, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))
        syncBadges(value)
        icon.icon = value.icon
        mark.isVisible = value.icon != null
        val note = value.description.orEmpty()
        desc.text = note
        desc.isVisible = note.isNotBlank()
        desc.foreground = weak

        syncCells(value, selected && list.isEnabled, list.isEnabled)
        top.invalidate()
        return this
    }

    private fun syncBadges(item: SettingsListItem) {
        badges.removeAll()
        badges.isVisible = item.badges.isNotEmpty()
        for (badge in item.badges) {
            badges.add(JBLabel().apply {
                border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
                icon = FilledBadgeIcon(badge.text, badge.style)
            })
        }
    }

    private fun syncCells(item: SettingsListItem, selected: Boolean, enabled: Boolean) {
        cells.removeAll()
        val visible = if (enabled) settingsListVisibleCells(item, selected) else emptyList()
        cells.isVisible = visible.isNotEmpty()
        cellPane.isVisible = visible.isNotEmpty()
        for (cell in visible) {
            cells.add(SettingsListActionCell(cell).apply {
                isEnabled = cell.enabled
            })
        }
    }

    internal fun cellTexts() = cells.components.filterIsInstance<JBLabel>().map { it.text }

    internal fun cellIcons() = cells.components.filterIsInstance<JBLabel>().map { it.icon }

    internal fun cellLabels() = cells.components.filterIsInstance<JBLabel>()

    internal fun badgeTexts() = badges.components.filterIsInstance<JBLabel>().mapNotNull { (it.icon as? FilledBadgeIcon)?.text }

    internal fun descriptionText() = desc.text

    internal fun iconVisible() = icon.icon != null

    internal fun iconSize() = icon.icon?.let { Dimension(it.iconWidth, it.iconHeight) }

}

internal class SettingsListActionCell(cell: SettingsListCell) : JBLabel(cell.label) {
    init {
        if (cell.iconOnly) text = ""
        icon = cell.icon
        toolTipText = cell.label.takeIf { it.isNotBlank() }
        horizontalAlignment = SwingConstants.CENTER
        if (!cell.iconOnly) UiStyle.Components.actionLabel(this, isEnabled)
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        if (text.isNotBlank()) UiStyle.Components.actionLabel(this, enabled)
    }
}
