package ai.kilocode.client.ui.picker

import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.CollectionListModel
import com.intellij.ui.GroupHeaderSeparator
import com.intellij.ui.NewUI
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

internal abstract class PickerListRenderer<T>(
    private val model: CollectionListModel<T>,
    private val checked: (T) -> Boolean,
    private val sectionTitle: (List<T>, Int) -> String?,
    protected val content: JComponent,
    private val trailing: JComponent? = null,
) : JPanel(BorderLayout()), ListCellRenderer<T> {
    companion object {
        val checkedIcon: Icon = AllIcons.Actions.Checked
        val emptyIcon: Icon = EmptyIcon.create(checkedIcon)

        fun trailingClickZone(list: JList<*>, bounds: Rectangle, point: Point, width: Int): Boolean {
            val size = JBUI.scale(width)
            val inset = trailingInset(list)
            if (list.componentOrientation.isLeftToRight) {
                val right = bounds.x + bounds.width - inset
                return point.x in (right - size)..right
            }
            val left = bounds.x + inset
            return point.x in left..(left + size)
        }

        private fun trailingInset(list: JList<*>): Int {
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
    private val row = JPanel(BorderLayout(JBUI.CurrentTheme.ActionsList.elementIconGap(), 0)).apply {
        border = JBUI.Borders.empty(
            UiStyle.Gap.md(),
            UiStyle.Gap.lg(),
            UiStyle.Gap.md(),
            UiStyle.Gap.pad(),
        )
        add(check, BorderLayout.WEST)
        add(content, BorderLayout.CENTER)
    }
    private val wrap = PickerRow()

    init {
        isOpaque = true
        top.isOpaque = true
        UiStyle.Components.transparent(row, check, content)
        trailing?.let { UiStyle.Components.transparent(it) }
        wrap.setContent(row, trailing)
        add(top, BorderLayout.NORTH)
        add(wrap, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out T>,
        value: T,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): Component {
        val focus = selected || list.hasFocus() || focused
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UiStyle.Colors.weak()
        val current = model.items.getOrNull(index)
        val section = if (current === value) sectionTitle(model.items, index) else null

        background = list.background
        top.background = list.background
        wrap.update(list, selected, focus)
        sep.caption = section
        sep.setHideLine(index == 0)
        top.isVisible = section != null
        check.icon = if (checked(value)) checkedIcon else emptyIcon
        update(value, index, selected, focus, fg, weak)
        top.invalidate()
        return this
    }

    protected abstract fun update(
        value: T,
        index: Int,
        selected: Boolean,
        focused: Boolean,
        foreground: java.awt.Color,
        weak: java.awt.Color,
    )
}
