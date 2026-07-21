package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.icons.AllIcons
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

internal class WorktreeRenderer :
    JPanel(BorderLayout()), ListCellRenderer<WorktreeDto> {
    companion object {
        private val gc: Icon = AllIcons.Actions.GC
        private val empty: Icon = EmptyIcon.create(gc)

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
    }

    private val text = SimpleColoredComponent()
    private val del = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
    }

    init {
        isOpaque = true
        border = JBUI.Borders.empty(UiStyle.Gap.lg())
        UiStyle.Components.transparent(text, del)
        add(text, BorderLayout.CENTER)
        add(del, BorderLayout.EAST)
    }

    override fun getListCellRendererComponent(
        list: JList<out WorktreeDto>,
        value: WorktreeDto?,
        index: Int,
        selected: Boolean,
        focus: Boolean,
    ): JPanel {
        val focused = selected || list.hasFocus() || focus
        val fg = UIUtil.getListForeground(selected, focused)

        background = UIUtil.getListBackground(selected, focused)
        text.clear()
        text.append(value?.name.orEmpty(), SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))
        value?.branch?.takeIf { it.isNotBlank() }?.let {
            text.append("  $it", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
        del.icon = if (selected && value?.main == false) gc else empty
        return this
    }

    internal fun deleteVisible(): Boolean = del.icon === gc
}
