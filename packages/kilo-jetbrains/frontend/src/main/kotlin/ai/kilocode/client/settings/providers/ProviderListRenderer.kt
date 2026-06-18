package ai.kilocode.client.settings.providers

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.PickerRow
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
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

private const val ACTION_GAP = 8

internal class ProviderListRenderer(
    private val model: CollectionListModel<ProviderListRow>,
) : JPanel(BorderLayout()), ListCellRenderer<ProviderListRow> {
    companion object {
        fun actionAt(list: JList<*>, bounds: Rectangle, point: Point, row: ProviderListRow, selected: Boolean): ProviderListAction? {
            val height = buttonHeight(list)
            val top = bounds.y + (bounds.height - height) / 2
            if (point.y !in top..(top + height)) return null
            var edge = bounds.x + bounds.width - UiStyle.Gap.pad()
            for (action in visibleActions(row, selected).asReversed()) {
                val width = buttonWidth(list, action)
                val left = edge - width
                if (point.x in left..edge) return action.takeIf(row::enabled)
                edge = left - JBUI.scale(ACTION_GAP)
            }
            return null
        }

        internal fun actionBounds(list: JList<*>, bounds: Rectangle, row: ProviderListRow, selected: Boolean): Map<ProviderListAction, Rectangle> {
            val height = buttonHeight(list)
            val top = bounds.y + (bounds.height - height) / 2
            var edge = bounds.x + bounds.width - UiStyle.Gap.pad()
            val out = linkedMapOf<ProviderListAction, Rectangle>()
            for (action in visibleActions(row, selected).asReversed()) {
                val width = buttonWidth(list, action)
                val left = edge - width
                out[action] = Rectangle(left, top, width, height)
                edge = left - JBUI.scale(ACTION_GAP)
            }
            return out
        }

        private fun buttonWidth(list: JList<*>, action: ProviderListAction): Int {
            val text = text(action)
            val metrics = list.getFontMetrics(list.font)
            return metrics.stringWidth(text) + UiStyle.Gap.pad() * 2
        }

        private fun buttonHeight(list: JList<*>): Int {
            val metrics = list.getFontMetrics(list.font)
            return metrics.height + UiStyle.Gap.sm() * 2
        }

        internal fun text(action: ProviderListAction) = when (action) {
            ProviderListAction.CONNECT -> KiloBundle.message("settings.providers.connect")
            ProviderListAction.OAUTH -> KiloBundle.message("settings.providers.oauth")
            ProviderListAction.DISCONNECT -> KiloBundle.message("settings.providers.disconnect")
            ProviderListAction.ENABLE -> KiloBundle.message("settings.providers.enable")
        }

        internal fun visibleActions(row: ProviderListRow, selected: Boolean): List<ProviderListAction> {
            if (row.disabled) return emptyList()
            if (row.connected) return row.actions.filter { it == ProviderListAction.DISCONNECT }
            if (!selected) return emptyList()
            return row.actions
        }
    }

    private val sep = GroupHeaderSeparator(JBUI.CurrentTheme.Popup.separatorLabelInsets())
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    private val icon = JBLabel()
    private val mark = icon.align(HAlign.CENTER, VAlign.TOP)
    private val title = SimpleColoredComponent()
    private val desc = JBLabel()
    private val text = Stack.vertical().next(title).next(desc)
    private val actions = Stack.horizontal(JBUI.scale(ACTION_GAP))
    private val actionPane = actions.align(HAlign.RIGHT, VAlign.CENTER)
    private val row = JPanel(BorderLayout(UiStyle.Gap.md(), 0)).apply {
        add(mark, BorderLayout.WEST)
        add(text, BorderLayout.CENTER)
        add(actionPane, BorderLayout.EAST)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, mark, icon, title, text, desc, actions, actionPane)
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
        list: JList<out ProviderListRow>,
        value: ProviderListRow,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val focus = selected || list.hasFocus() || focused
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UiStyle.Colors.weak()
        val current = model.items.getOrNull(index)
        val section = if (current === value) providerListSectionTitle(model.items, index) else null

        background = list.background
        top.background = list.background
        wrap.update(list, selected, focus)
        sep.caption = section
        sep.setHideLine(index == 0)
        top.isVisible = section != null

        title.clear()
        title.append(value.provider.name, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))
        icon.icon = providerIcon(value.provider)
        val note = providerDescription(value.provider)
        desc.text = note
        desc.isVisible = note.isNotEmpty()
        desc.foreground = weak

        actions.removeAll()
        val visible = visibleActions(value, selected)
        actions.isVisible = visible.isNotEmpty()
        actionPane.isVisible = visible.isNotEmpty()
        for (action in visible) {
            actions.add(ActionLabel(action).apply {
                isEnabled = value.enabled(action)
                UiStyle.Components.actionLabel(this, isEnabled)
            })
        }
        top.invalidate()
        return this
    }

    internal fun actionTexts() = actions.components.filterIsInstance<JBLabel>().map { it.text }

    internal fun descriptionText() = desc.text

    internal fun providerIconVisible() = icon.icon != null

    internal fun providerIconSize() = icon.icon?.let { Dimension(it.iconWidth, it.iconHeight) }

    private class ActionLabel(action: ProviderListAction) : JBLabel(text(action)) {
        init {
            horizontalAlignment = SwingConstants.CENTER
            UiStyle.Components.actionLabel(this)
        }
    }
}
