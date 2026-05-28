package ai.kilocode.client.session.scroll

import ai.kilocode.client.ui.colorizeIfPossible
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.util.IconLoader
import com.intellij.util.ui.JBUI
import java.awt.Color
import javax.swing.Icon

internal object ScrollButtonIcon {
    private val bottom = IconLoader.getIcon("/icons/scroll-bottom.svg", ScrollButtonIcon::class.java)
    private val prompt = IconLoader.getIcon("/icons/scroll-question.svg", ScrollButtonIcon::class.java)

    fun create(question: Boolean = false): Icon {
        if (question) {
            return prompt.colorizeIfPossible(
                fillColor = UiStyle.Colors.warningLabelForeground(),
                borderColor = Color.WHITE,
                fillId = "ScrollQuestion.Background",
                strokeId = "ScrollQuestion.Foreground",
            )
        }

        return bottom.colorizeIfPossible(
            fillColor = JBUI.CurrentTheme.Button.defaultButtonColorStart(),
            borderColor = JBUI.CurrentTheme.Button.defaultButtonForeground(),
            fillId = "ScrollButton.Background",
            strokeId = "ScrollButton.Foreground",
        )
    }
}
