package ai.kilocode.client.settings

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.log.LogConfig
import com.intellij.openapi.ui.ComboBox
import com.intellij.platform.ide.productMode.IdeProductMode
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.DefaultComboBoxModel
import javax.swing.JPanel

internal class AdvancedSettingsUi : JPanel(BorderLayout()) {
    data class Values(
        val level: LogConfig.LogLevel,
        val mode: LogConfig.ContentMode,
        val preview: Int,
        val indexWorktrees: Boolean,
    )

    private val level = ComboBox(DefaultComboBoxModel(LogConfig.LogLevel.all.toTypedArray()))
    private val mode = ComboBox(DefaultComboBoxModel(LogConfig.ContentMode.all.toTypedArray()))
    private val preview = JBTextField().apply { columns = 6 }

    /** Set once the user flips the toggle, so a late backend fetch cannot overwrite their choice. */
    private var touched = false
    private val indexWorktrees = SettingsToggle { touched = true }

    private var saved = current()

    init {
        resetForm()

        val rows = SettingsRows().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad(), UiStyle.Gap.lg())
            row(TitledSeparator(KiloBundle.message("settings.advanced.logging.title")))
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
            logRows().forEach(::row)
            row(TitledSeparator(KiloBundle.message("settings.advanced.indexing.title")))
            row(SettingsRow(
                KiloBundle.message("settings.advanced.indexWorktrees.title"),
                KiloBundle.message("settings.advanced.indexWorktrees.description"),
                indexWorktrees,
            ))
        }
        add(rows, BorderLayout.CENTER)
    }

    fun modified(): Boolean {
        if (level.selectedItem != saved.level) return true
        if (mode.selectedItem != saved.mode) return true
        if (indexWorktrees.isSelected != saved.indexWorktrees) return true
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
        indexWorktrees.isSelected = saved.indexWorktrees
        touched = false
    }

    fun sync() {
        saved = value()
        resetForm()
    }

    fun value(): Values = Values(
        level = level.selectedItem as LogConfig.LogLevel,
        mode = mode.selectedItem as LogConfig.ContentMode,
        preview = count() ?: saved.preview,
        indexWorktrees = indexWorktrees.isSelected,
    )

    /** The index-worktrees value as of the last [sync] (or the initial fetch via [refreshIndexWorktrees]). */
    fun savedIndexWorktrees(): Boolean = saved.indexWorktrees

    /**
     * Populates the toggle with the value fetched asynchronously from the backend. The fetch is a
     * no-op once the user has flipped the toggle: in split mode the RPC can land after they acted,
     * and overwriting then would silently discard their choice and clear [modified].
     */
    @RequiresEdt
    fun refreshIndexWorktrees(value: Boolean) {
        if (touched) return
        saved = saved.copy(indexWorktrees = value)
        indexWorktrees.isSelected = value
    }

    private fun current(): Values = Values(LogConfig.level(), LogConfig.contentMode(), LogConfig.previewMax(), indexWorktrees = false)

    private fun count(): Int? = preview.text.trim().toIntOrNull()

    // In monolith mode one reveal opens the shared log; in split mode the client log is revealed
    // locally and the remote backend log is downloaded.
    private fun logRows(): List<SettingsRow> {
        if (IdeProductMode.isMonolith) {
            return listOf(SettingsRow(
                KiloBundle.message("settings.advanced.logs.title"),
                KiloBundle.message("settings.advanced.logs.description"),
                ActionLink(AdvancedLogActions.revealLabel()) { AdvancedLogActions.reveal() },
            ))
        }
        return listOf(
            SettingsRow(
                KiloBundle.message("settings.advanced.logs.client.title"),
                KiloBundle.message("settings.advanced.logs.client.description"),
                ActionLink(AdvancedLogActions.revealLabel()) { AdvancedLogActions.reveal() },
            ),
            SettingsRow(
                KiloBundle.message("settings.advanced.logs.backend.title"),
                KiloBundle.message("settings.advanced.logs.backend.description"),
                ActionLink(KiloBundle.message("settings.advanced.logs.backend.download")) {
                    AdvancedLogActions.downloadBackend(this)
                },
            ),
        )
    }
}
