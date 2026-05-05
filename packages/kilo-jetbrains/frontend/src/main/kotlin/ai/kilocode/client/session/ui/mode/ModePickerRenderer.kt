package ai.kilocode.client.session.ui.mode

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.PickerRow
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.RoundedLineBorder
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.Icon
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingConstants

internal class ModePickerRenderer(
    private val active: () -> String?,
) : JPanel(BorderLayout()), ListCellRenderer<ModePicker.Item> {

    companion object {
        const val MAX_ROWS = 8
        val checked: Icon = AllIcons.Actions.Checked
        val empty: Icon = EmptyIcon.create(checked)
    }

    private val icon = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        verticalAlignment = SwingConstants.CENTER
        UiStyle.Components.transparent(this)
    }
    private val title = SimpleColoredComponent().apply {
        UiStyle.Components.transparent(this)
    }
    private val desc = SimpleColoredComponent().apply {
        UiStyle.Components.transparent(this)
    }
    private val badge = JBLabel(KiloBundle.message("mode.picker.deprecated")).apply {
        UiStyle.Components.transparent(this)
    }
    private val head = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
        UiStyle.Components.transparent(this)
        add(title)
        add(badge)
    }
    private val body = JPanel(BorderLayout()).apply {
        UiStyle.Components.transparent(this)
    }
    private val row = JPanel(BorderLayout())
    private val wrap = PickerRow()

    init {
        UiStyle.Components.transparent(this)
        UiStyle.Components.transparent(row)
        (row.layout as BorderLayout).hgap = UiStyle.Gap.inline()
        row.border = JBUI.Borders.empty(
            UiStyle.Space.MD,
            UiStyle.Space.LG,
            UiStyle.Space.MD,
            UiStyle.Space.LG,
        )
        body.add(head, BorderLayout.NORTH)
        body.add(desc, BorderLayout.CENTER)
        row.add(icon, BorderLayout.WEST)
        row.add(body, BorderLayout.CENTER)
        wrap.setContent(row)
        add(wrap, BorderLayout.CENTER)
    }

    override fun getListCellRendererComponent(
        list: JList<out ModePicker.Item>,
        value: ModePicker.Item,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        val focus = selected || list.hasFocus() || focused
        val fg = UIUtil.getListForeground(selected, focus)
        val weak = if (selected) fg else UiStyle.Colors.weak()
        val warn = if (selected) fg else UiStyle.Colors.warning()

        background = list.background
        wrap.update(list, selected, focus)
        title.clear()
        title.append(value.display, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, fg))
        desc.clear()
        desc.isVisible = value.description?.isNotBlank() == true
        value.description?.takeIf { it.isNotBlank() }?.let {
            desc.append(it, SimpleTextAttributes(SimpleTextAttributes.STYLE_SMALLER, weak))
        }
        badge.isVisible = value.deprecated
        badge.foreground = warn
        badge.border = JBUI.Borders.compound(
            JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap()),
            JBUI.Borders.compound(
                RoundedLineBorder(warn, JBUI.scale(UiStyle.Space.SM)),
                JBUI.Borders.empty(0, UiStyle.Space.MD),
            ),
        )
        icon.icon = icon(value)
        return this
    }

    internal fun icon(value: ModePicker.Item): Icon = when {
        value.id != active() -> empty
        else -> checked
    }

    internal fun badgeVisible(): Boolean = badge.isVisible

    internal fun badgeText(): String = badge.text

    internal fun detailsVisible(): Boolean = desc.isVisible
}
