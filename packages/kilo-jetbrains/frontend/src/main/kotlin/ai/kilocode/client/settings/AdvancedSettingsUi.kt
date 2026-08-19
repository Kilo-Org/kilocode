package ai.kilocode.client.settings

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.log.LogConfig
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.DefaultComboBoxModel
import javax.swing.JPanel

internal class AdvancedSettingsUi : JPanel(BorderLayout()) {
    data class Values(
        val level: LogConfig.LogLevel,
        val mode: LogConfig.ContentMode,
        val preview: Int,
    )

    private val level = ComboBox(DefaultComboBoxModel(LogConfig.LogLevel.all.toTypedArray()))
    private val mode = ComboBox(DefaultComboBoxModel(LogConfig.ContentMode.all.toTypedArray()))
    private val preview = JBTextField().apply { columns = 6 }

    private var saved = current()

    init {
        resetForm()

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
        add(rows, BorderLayout.CENTER)
    }

    fun modified(): Boolean {
        if (level.selectedItem != saved.level) return true
        if (mode.selectedItem != saved.mode) return true
        return preview.text.trim() != saved.preview.toString()
    }

    fun error(): String? {
        val value = count() ?: return KiloBundle.message("logs.configuration.previewSize.invalid")
        if (value !in LogConfig.MIN_PREVIEW..LogConfig.MAX_PREVIEW) {
            return KiloBundle.message("logs.configuration.previewSize.outOfRange", LogConfig.MIN_PREVIEW, LogConfig.MAX_PREVIEW)
        }
        return null
    }

    fun resetForm() {
        level.selectedItem = saved.level
        mode.selectedItem = saved.mode
        preview.text = saved.preview.toString()
    }

    fun sync() {
        saved = value()
        resetForm()
    }

    fun value(): Values = Values(
        level = level.selectedItem as LogConfig.LogLevel,
        mode = mode.selectedItem as LogConfig.ContentMode,
        preview = count() ?: saved.preview,
    )

    private fun current(): Values = Values(LogConfig.level(), LogConfig.contentMode(), LogConfig.previewMax())

    private fun count(): Int? = preview.text.trim().toIntOrNull()
}
