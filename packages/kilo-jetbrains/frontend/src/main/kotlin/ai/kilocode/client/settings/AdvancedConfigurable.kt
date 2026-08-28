package ai.kilocode.client.settings

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.options.SearchableConfigurable
import javax.swing.JComponent

class AdvancedConfigurable(
    private val settings: KiloLogSettingsService = KiloLogSettingsService.getInstance(),
    private val save: (KiloLogSettingsService) -> Unit = { it.apply() },
) : SearchableConfigurable, Configurable.NoScroll {
    private var ui: AdvancedSettingsUi? = null

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.advanced.displayName")

    override fun createComponent(): JComponent {
        settings.applyLocal()
        val panel = AdvancedSettingsUi()
        ui = panel
        return panel
    }

    override fun isModified(): Boolean = ui?.modified() == true

    override fun apply() {
        val panel = ui ?: return
        val err = panel.error()
        if (err != null) throw ConfigurationException(err)
        val value = panel.value()
        settings.update(value.level, value.mode, value.preview)
        save(settings)
        panel.sync()
    }

    override fun reset() {
        ui?.resetForm()
    }

    override fun disposeUIResources() {
        ui = null
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.advanced"
    }
}
