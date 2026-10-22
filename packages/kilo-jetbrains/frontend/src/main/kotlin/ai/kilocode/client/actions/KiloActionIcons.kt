package ai.kilocode.client.actions

import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.util.IconUtil
import javax.swing.Icon

internal object KiloActionIcons {
    val add: Icon = IconUtil.resizeSquared(AllIcons.General.Add, UiStyle.ToolbarButton.ICON_SIZE)
}
