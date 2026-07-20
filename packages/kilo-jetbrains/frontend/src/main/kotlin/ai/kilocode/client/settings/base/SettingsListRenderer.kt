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
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

internal class SettingsListRenderer(
    private val model: CollectionListModel<SettingsListItem>,
    private val cfg: SettingsListConfig = SettingsListConfig.Equal,
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
    private val textPane = text.align(HAlign.TRACK, if (cfg.description) VAlign.FIT else VAlign.CENTER)
    private val cells = Stack.horizontal(settingsListCellGap())
    private val cellPane = cells.align(HAlign.RIGHT, VAlign.CENTER)
    private val row = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(mark, BorderLayout.WEST)
        add(textPane, BorderLayout.CENTER)
        add(cellPane, BorderLayout.EAST)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, mark, icon, title, badges, head, text, textPane, desc, cells, cellPane)
        row.border = JBUI.Borders.empty(
            UiStyle.Gap.md(),
            0,
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
        value.note?.takeIf { it.isNotBlank() }?.let {
            title.append("  $it", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
        syncBadges(value)
        icon.icon = value.icon
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

        syncCells(value, selected && list.isEnabled, list.isEnabled)
        top.invalidate()
        return this
    }

    private fun syncBadges(item: SettingsListItem) {
        val items = item.badges
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

    private fun syncCells(item: SettingsListItem, selected: Boolean, enabled: Boolean) {
        val visible = if (enabled) settingsListVisibleCells(item, selected) else emptyList()
        while (cells.componentCount > visible.size) cells.remove(cells.componentCount - 1)
        while (cells.componentCount < visible.size) cells.add(SettingsListActionCell())
        cells.isVisible = visible.isNotEmpty()
        cellPane.isVisible = visible.isNotEmpty()
        for (i in visible.indices) {
            (cells.getComponent(i) as SettingsListActionCell).update(visible[i])
        }
    }
}

internal class SettingsListActionCell : JBLabel() {
    var cellId: String = ""
        private set

    fun update(cell: SettingsListCell) {
        cellId = cell.id
        text = if (cell.iconOnly) "" else cell.label
        icon = cell.icon
        toolTipText = cell.label.takeIf { it.isNotBlank() }
        horizontalAlignment = SwingConstants.CENTER
        isEnabled = cell.enabled
        if (!cell.iconOnly) UiStyle.Components.actionLabel(this, isEnabled)
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        if (text.isNotBlank()) UiStyle.Components.actionLabel(this, enabled)
    }
}
