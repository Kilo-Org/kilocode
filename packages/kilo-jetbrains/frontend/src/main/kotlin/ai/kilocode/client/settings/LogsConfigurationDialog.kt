package ai.kilocode.client.settings

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.log.LogConfig
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.DefaultComboBoxModel
import javax.swing.JComponent
import javax.swing.JPanel

class LogsConfigurationDialog(
    private val settings: KiloLogSettingsService = KiloLogSettingsService.getInstance(),
) : DialogWrapper(true) {
    private val level = ComboBox(DefaultComboBoxModel(LogConfig.LogLevel.all.toTypedArray()))
    private val mode = ComboBox(DefaultComboBoxModel(LogConfig.ContentMode.all.toTypedArray()))
    private val preview = JBTextField().apply { columns = 6 }

    init {
        title = KiloBundle.message("logs.configuration.dialog.title")
        settings.applyLocal()
        level.selectedItem = LogConfig.level()
        mode.selectedItem = LogConfig.contentMode()
        preview.text = LogConfig.previewMax().toString()
        init()
    }

    override fun createCenterPanel(): JComponent {
        val rows = SettingsRows().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad(), UiStyle.Gap.lg())
            row(SettingsRow(
                KiloBundle.message("logs.configuration.level.title"),
                KiloBundle.message("logs.configuration.level.description"),
                level,
            ))
            row(SettingsRow(
                KiloBundle.message("logs.configuration.preview.title"),
                KiloBundle.message("logs.configuration.preview.description"),
                mode,
            ))
            row(SettingsRow(
                KiloBundle.message("logs.configuration.previewSize.title"),
                KiloBundle.message("logs.configuration.previewSize.description", LogConfig.MIN_PREVIEW, LogConfig.MAX_PREVIEW),
                preview,
            ))
        }
        return JPanel(BorderLayout()).apply { add(rows, BorderLayout.CENTER) }
    }

    override fun getPreferredFocusedComponent(): JComponent = level

    override fun getDimensionServiceKey(): String = "Kilo.LogsConfigurationDialog"

    override fun doValidate(): ValidationInfo? {
        val value = preview.text.trim().toIntOrNull()
            ?: return ValidationInfo(KiloBundle.message("logs.configuration.previewSize.invalid"), preview)
        if (value !in LogConfig.MIN_PREVIEW..LogConfig.MAX_PREVIEW) {
            return ValidationInfo(
                KiloBundle.message("logs.configuration.previewSize.outOfRange", LogConfig.MIN_PREVIEW, LogConfig.MAX_PREVIEW),
                preview,
            )
        }
        return null
    }

    override fun doOKAction() {
        if (doValidate() != null) return
        settings.update(
            level.selectedItem as LogConfig.LogLevel,
            mode.selectedItem as LogConfig.ContentMode,
            preview.text.trim().toInt(),
        )
        settings.apply()
        super.doOKAction()
    }
}
