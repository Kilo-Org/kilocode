package ai.kilocode.client.settings.integrations

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.util.Disposer
import javax.swing.JComponent

/**
 * Integrations settings page. Not a [ai.kilocode.client.settings.base.DraftReadyConfigurable]: its
 * settings are local IDE preferences that must stay editable when the CLI is unavailable, and each
 * toggle writes immediately, so there is nothing to apply or revert.
 */
class IntegrationsConfigurable : SearchableConfigurable, Configurable.NoMargin, Configurable.NoScroll {
    private var ui: IntegrationsSettingsUi? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.integrations.displayName")

    override fun createComponent(): JComponent = IntegrationsSettingsUi().also { ui = it }

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
        const val ID = "ai.kilocode.jetbrains.settings.integrations"
    }
}
