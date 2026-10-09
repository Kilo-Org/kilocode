package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.util.Disposer
import javax.swing.JComponent

/**
 * Transcript settings page. Not a [ai.kilocode.client.settings.base.DraftReadyConfigurable]: its
 * settings are local IDE preferences that must stay editable when the CLI is unavailable, and each
 * control writes immediately, so there is nothing to apply or revert.
 */
class TranscriptConfigurable : SearchableConfigurable, Configurable.NoMargin, Configurable.NoScroll {
    private var ui: TranscriptSettingsUi? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.transcript.displayName")

    override fun createComponent(): JComponent = TranscriptSettingsUi().also { ui = it }

    override fun isModified(): Boolean = false

    override fun apply() = Unit

    override fun reset() {
        ui?.sync()
    }

    override fun disposeUIResources() {
        ui?.let { Disposer.dispose(it) }
        ui = null
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.transcript"
    }
}
