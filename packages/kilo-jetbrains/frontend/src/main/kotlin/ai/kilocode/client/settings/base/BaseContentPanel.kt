package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil

open class BaseContentPanel : Stack(StackAxis.VERTICAL) {
    fun section(title: String, description: String? = null): SettingsRows {
        next(TitledSeparator(title))
        if (description != null) {
            next(JBLabel(description).apply {
                foreground = UIUtil.getContextHelpForeground()
                font = UiStyle.Fonts.small()
            })
        }
        val rows = SettingsRows()
        next(rows)
        return rows
    }
}
