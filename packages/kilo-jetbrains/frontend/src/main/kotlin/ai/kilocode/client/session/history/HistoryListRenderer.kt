package ai.kilocode.client.session.history

import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

private const val DELETE_AREA_WIDTH = 32

internal open class HistoryRenderer<T : HistoryItem>(
    private val model: HistoryModel<T>,
    private val deletable: Boolean,
) : JPanel(BorderLayout()), ListCellRenderer<T> {
    companion object {
        private val icon: Icon = AllIcons.Actions.GC
        private val empty: Icon = EmptyIcon.create(icon)

        fun isDeleteClick(list: JList<*>, bounds: Rectangle, point: Point): Boolean {
            val width = JBUI.scale(DELETE_AREA_WIDTH)
            return if (list.componentOrientation.isLeftToRight) {
                val right = bounds.x + bounds.width
                point.x in (right - width)..right
            } else {
                val left = bounds.x
                point.x in left..(left + width)
            }
        }

        fun section(items: List<HistoryItem>, index: Int): String? {
            val item = items.getOrNull(index) ?: return null
            val current = HistoryTime.section(item)
            val previous = items.getOrNull(index - 1)?.let(HistoryTime::section)
            if (current == previous) return null
            return HistoryTime.title(current)
        }
    }

    private val sep = GroupHeaderSeparator(JBUI.CurrentTheme.Popup.separatorLabelInsets())
    private val top = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(sep, BorderLayout.NORTH)
    }
    private val title = SimpleColoredComponent()
    private val time = JBLabel()
    private val del = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
    }
    private val main = JPanel(BorderLayout()).apply {
        add(title, BorderLayout.CENTER)
        add(time, BorderLayout.EAST)
    }
    private val row = JPanel(BorderLayout()).apply {
        add(main, BorderLayout.CENTER)
        if (deletable) add(del, BorderLayout.EAST)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        row.border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg(), UiStyle.Gap.lg())
        UiStyle.Components.transparent(row, main, title, time, del)
        wrap.setContent(row)
        add(top, BorderLayout.NORTH)
        add(wrap, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out T>,
        value: T?,
        index: Int,
        selected: Boolean,
        focus: Boolean,
    ): JPanel {
        val focused = selected || list.hasFocus() || focus
        val fg = UIUtil.getListForeground(selected, focused)
        val weak = if (selected) fg else UIUtil.getContextHelpForeground()

        background = list.background
        top.background = list.background
        wrap.update(list, selected, focused)
        sep.caption = section(model.visibleItems, index)
        sep.setHideLine(index == 0)
        top.isVisible = sep.caption != null

        title.clear()
        title.append(
            value?.let(::title).orEmpty(),
            SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg),
        )
        time.text = value?.let(HistoryTime::relative).orEmpty()
        time.foreground = weak
        if (deletable) del.icon = if (selected) icon else empty

        top.invalidate()
        return this
    }
}

internal class LocalHistoryRenderer(model: HistoryModel<LocalHistoryItem>) : HistoryRenderer<LocalHistoryItem>(model, deletable = true)

internal class CloudHistoryRenderer(model: HistoryModel<CloudHistoryItem>) : HistoryRenderer<CloudHistoryItem>(model, deletable = false)
