package ai.kilocode.client.session.scroll

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

internal object ScrollButtonIcon {
    private val bottom: Icon = IconLoader.getIcon("/icons/scroll-bottom.svg", ScrollButtonIcon::class.java)
    private val prompt: Icon = IconLoader.getIcon("/icons/scroll-question.svg", ScrollButtonIcon::class.java)

    fun create(question: Boolean = false): Icon {
        if (question) return prompt
        return bottom
    }
}
