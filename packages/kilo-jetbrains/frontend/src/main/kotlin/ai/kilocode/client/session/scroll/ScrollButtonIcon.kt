package ai.kilocode.client.session.scroll

import ai.kilocode.client.ui.colorizeIfPossible
import com.intellij.openapi.util.IconLoader
import com.intellij.util.ui.JBUI
import javax.swing.Icon

internal object ScrollButtonIcon {
    private val icon = IconLoader.getIcon("/icons/scroll-bottom.svg", ScrollButtonIcon::class.java)

    fun create(): Icon = icon.colorizeIfPossible(
        fillColor = JBUI.CurrentTheme.Button.defaultButtonColorStart(),
        borderColor = JBUI.CurrentTheme.Button.defaultButtonForeground(),
        fillId = "ScrollButton.Background",
        strokeId = "ScrollButton.Foreground",
    )
}
