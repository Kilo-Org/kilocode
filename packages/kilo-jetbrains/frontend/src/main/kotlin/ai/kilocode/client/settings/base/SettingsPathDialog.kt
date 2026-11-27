package ai.kilocode.client.settings.base

import com.intellij.CommonBundle
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBTextField
import javax.swing.JComponent

/** Testable handle over [SettingsPathDialog] so callers can stub the modal dialog in tests. */
internal interface SettingsPathDialogHandle {
    fun showAndGet(): Boolean
    fun value(): String
}

/**
 * Single-line text entry dialog for a path, glob, or URL. When [browse] is provided the field gains
 * the standard "..." file-chooser button; otherwise it is a plain text field. Confirms with "OK"
 * (the value is persisted later by the owning settings page) and focuses the field on open.
 */
internal class SettingsPathDialog(
    title: String,
    value: String = "",
    private val browse: ((JComponent) -> String?)? = null,
) : DialogWrapper(true), SettingsPathDialogHandle {
    private val field = JBTextField(value)

    init {
        this.title = title
        setOKButtonText(CommonBundle.getOkButtonText())
        init()
    }

    override fun createCenterPanel(): JComponent {
        field.columns = COLUMNS
        return browse?.let { settingsPathInput(field, it) } ?: field
    }

    override fun getPreferredFocusedComponent(): JComponent = field

    override fun value(): String = field.text

    private companion object {
        const val COLUMNS = 60
    }
}
