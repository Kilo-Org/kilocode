package ai.kilocode.client.session.ui

import com.intellij.openapi.ui.popup.util.PopupUtil
import com.intellij.ui.NewUI
import com.intellij.ui.popup.list.SelectablePanel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JList

internal class PickerRow : SelectablePanel() {
    init {
        layout = BorderLayout()
        isOpaque = true
    }

    fun setContent(component: JComponent) {
        accessibleContextProvider = component
        add(component, BorderLayout.CENTER)
    }

    fun update(list: JList<*>, selected: Boolean, focused: Boolean) {
        background = list.background
        selectionColor = if (selected) UIUtil.getListBackground(true, focused) else null
        if (NewUI.isEnabled()) {
            PopupUtil.configListRendererFlexibleHeight(this)
            return
        }
        border = JBUI.Borders.empty()
        selectionArc = 0
        selectionInsets = JBUI.emptyInsets()
    }
}
