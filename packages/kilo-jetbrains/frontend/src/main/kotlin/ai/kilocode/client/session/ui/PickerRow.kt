package ai.kilocode.client.session.ui

import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.ui.popup.list.SelectablePanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.border.Border

internal class PickerRow : SelectablePanel() {
    init {
        layout = BorderLayout()
        isOpaque = true
    }

    fun setContent(component: JComponent, trailing: JComponent? = null, border: Border? = null) {
        removeAll()
        component.border = border ?: component.border
        accessibleContextProvider = component
        add(component, BorderLayout.CENTER)
        if (trailing != null) add(trailing.align(HAlign.RIGHT, VAlign.CENTER), BorderLayout.EAST)
    }

    fun update(list: JList<*>, selected: Boolean, focused: Boolean) {
        update(
            background = list.background,
            selectionColor = if (selected) UIUtil.getListBackground(true, focused) else null,
            opaque = true,
            paintSelection = true,
        )
    }

    /**
     * Container-neutral update for hosts that already know their backdrop and selection color, such
     * as the native tree, where the tree itself paints the selection and the row must stay transparent.
     */
    fun update(background: Color?, selectionColor: Color?, opaque: Boolean, paintSelection: Boolean) {
        this.background = background
        isOpaque = opaque
        this.selectionColor = if (paintSelection) selectionColor else null
        // Active rows supply their own compact padding. The popup flexible border adds another
        // platform inset on both sides, which stacks with the row padding and leaves a wide gutter.
        border = JBUI.Borders.empty()
        selectionArc = JBUI.CurrentTheme.Popup.Selection.ARC.get()
        selectionInsets = JBUI.emptyInsets()
    }
}
